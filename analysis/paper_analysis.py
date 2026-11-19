#!/usr/bin/env python3
"""Paper-level analyses on top of evaluation/v3/analyze.ts (standard library only).

Reads a v3 experiment directory (runs.jsonl, artifacts.json) and writes
<dir>/analysis/paper_analysis.json and <dir>/analysis/paper_tables.md with:

  1. population accounting per cell;
  2. cast-gas decomposition: steady-state per-ballot gas per workflow, first-ballot
     and first-vote-per-candidate premiums, and the model of Equation (castdiff);
  3. run-median sensitivity for the proof-time contrasts, with host-stall counts;
  4. the proving-time model T = alpha*m + kappa(N), fitted on public-circuit
     cells of the DEPTH family and evaluated on the commitment circuits;
  5. memory against proving-key size;
  6. result-phase gas and time against B (SCALE) and C (CANDIDATES), the
     marginal reveal cost and the break-even election size;
  7. checks of the time model: leave-one-depth-out refits on the public cells, the
     commitment prediction at D = 12 without its near-replica public cell, and the
     measured and predicted proof-time ratio at the threshold (block bootstrap);
  8. memory controls: the Reveal - Publisher contrast (same circuit and key, expected
     zero) and the absolute peak resident set size of the proving process;
  9. host disturbances: stalls and their effect on run means, and drift within cells.

Usage: python3 -I analysis/paper_analysis.py <experiment-dir>
"""
import json
import math
import random
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

PUB, PBR, REV = "PUBLIC_DISCLOSURE", "COMMITMENT_BALLOT_HIDING", "COMMITMENT_ONCHAIN_REVEAL"
WORKFLOWS = (PUB, PBR, REV)
NAMES = {PUB: "Public", PBR: "Publisher", REV: "Reveal"}
STALL_FACTOR = 3.0  # a ballot is a "stall" if its proof time exceeds 3x its run median
BOOTSTRAP_REPLICATES = 2000
BOOTSTRAP_SEED = 20261112  # fixed, so that the released outputs are reproducible byte for byte
THRESHOLD_CELL = "DEPTH-D13"


# ---------------------------------------------------------------- statistics
def t_quantile_975(df: int) -> float:
    """Two-sided 95% Student-t critical value (exact table for small df, normal tail beyond)."""
    table = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
             9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
             16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086, 25: 2.060, 30: 2.042}
    if df in table:
        return table[df]
    keys = sorted(table)
    if df > keys[-1]:
        return 1.96 + 2.4 / df  # adequate above 30 df
    lo = max(k for k in keys if k < df)
    hi = min(k for k in keys if k > df)
    return table[lo] + (table[hi] - table[lo]) * (df - lo) / (hi - lo)


def paired(diffs):
    n = len(diffs)
    mean = st.mean(diffs)
    if n < 2:
        return {"n": n, "mean": mean, "lo": None, "hi": None}
    se = st.stdev(diffs) / math.sqrt(n)
    q = t_quantile_975(n - 1)
    return {"n": n, "mean": mean, "lo": mean - q * se, "hi": mean + q * se}


def lstsq(rows, ys):
    """Ordinary least squares via normal equations (small, well-conditioned problems)."""
    k = len(rows[0])
    ata = [[sum(r[i] * r[j] for r in rows) for j in range(k)] for i in range(k)]
    aty = [sum(r[i] * y for r, y in zip(rows, ys)) for i in range(k)]
    # Gaussian elimination with partial pivoting
    m = [row[:] + [b] for row, b in zip(ata, aty)]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(k):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [a - f * b for a, b in zip(m[r], m[c])]
    return [m[i][k] / m[i][i] for i in range(k)]


# ---------------------------------------------------------------- loading
def load(directory: Path):
    runs = [json.loads(line) for line in (directory / "runs.jsonl").read_text().splitlines() if line.strip()]
    artifacts = {a["configuration"]: a for a in json.loads((directory / "artifacts.json").read_text())}
    return runs, artifacts


def proof_ms(ballot):
    return ballot["witnessMs"] + ballot["proveMs"]


# ---------------------------------------------------------------- analyses
def population(runs):
    cells = defaultdict(lambda: {"blocks": set(), "runs": 0, "ballots": 0})
    for r in runs:
        c = cells[r["cellId"]]
        c["blocks"].add(r["block"])
        c["runs"] += 1
        c["ballots"] += len(r["ballots"])
    return {k: {"blocks": len(v["blocks"]), "runs": v["runs"], "ballots": v["ballots"]} for k, v in cells.items()}


def gas_decomposition(runs):
    out = {}
    for cell in sorted({r["cellId"] for r in runs}):
        per = {}
        for wf in WORKFLOWS:
            first, newcand, steady = [], [], []
            for r in (x for x in runs if x["cellId"] == cell and x["workflow"] == wf):
                seen = set()
                for b in r["ballots"]:
                    is_new = b["vote"] not in seen
                    seen.add(b["vote"])
                    (first if b["index"] == 0 else newcand if is_new else steady).append(b["castGas"])
            g = st.mean(steady)
            per[wf] = {
                "steady_mean": g, "steady_min": min(steady), "steady_max": max(steady),
                "first_premium": st.mean(first) - g,
                "new_candidate_premium": (st.mean(newcand) - g) if newcand else None,
            }
        # model check of the mean per-ballot difference, block by block
        errors = []
        for blk in sorted({r["block"] for r in runs if r["cellId"] == cell}):
            rs = {r["workflow"]: r for r in runs if r["cellId"] == cell and r["block"] == blk}
            if set(rs) != set(WORKFLOWS):
                continue
            b = len(rs[PUB]["ballots"])
            k = len({x["vote"] for x in rs[PUB]["ballots"]})
            measured = (sum(x["castGas"] for x in rs[PBR]["ballots"]) - sum(x["castGas"] for x in rs[PUB]["ballots"])) / b
            predicted = (per[PBR]["steady_mean"] - per[PUB]["steady_mean"]) - 17100 * (k - 1) / b
            errors.append(measured - predicted)
        per["model_mean_diff_error"] = {"max_abs": max(abs(e) for e in errors) if errors else None}
        out[cell] = per
    return out


def time_contrasts(runs):
    """Run means (primary) and run medians (sensitivity) of proof time; stall counts."""
    out = {}
    for cell in sorted({r["cellId"] for r in runs}):
        blocks = defaultdict(dict)
        stalls = defaultdict(int)
        for r in (x for x in runs if x["cellId"] == cell):
            t = [proof_ms(b) for b in r["ballots"]]
            med = st.median(t)
            blocks[r["block"]][r["workflow"]] = {"mean": st.mean(t), "median": med}
            stalls[r["workflow"]] += sum(1 for x in t if x > STALL_FACTOR * med)
        complete = [v for v in blocks.values() if set(v) == set(WORKFLOWS)]
        res = {"stalls": dict(stalls)}
        for stat in ("mean", "median"):
            for a, b in ((PBR, PUB), (REV, PUB), (REV, PBR)):
                diffs = [v[a][stat] - v[b][stat] for v in complete]
                ratios = [v[a][stat] / v[b][stat] for v in complete]
                res[f"{stat}:{NAMES[a]}-{NAMES[b]}"] = {**paired(diffs), "ratio": st.mean(ratios)}
            for wf in WORKFLOWS:
                vals = [v[wf][stat] for v in complete]
                res[f"{stat}:{NAMES[wf]}"] = {"mean": st.mean(vals), "sd": st.stdev(vals) if len(vals) > 1 else 0.0}
        out[cell] = res
    return out


def time_model(runs, artifacts):
    """Fit T = alpha*m + kappa_N on public DEPTH cells (run means); predict commitment cells."""
    def run_means(wf_filter, circuit):
        pts = []
        for r in runs:
            if r["family"] != "DEPTH" or not wf_filter(r["workflow"]):
                continue
            art = artifacts[r["configuration"]][circuit]
            pts.append((art["wires"], art["domainSize"], st.mean(proof_ms(b) for b in r["ballots"]), r["cellId"]))
        return pts
    train = run_means(lambda w: w == PUB, "public")
    domains = sorted({p[1] for p in train})
    rows = [[p[0]] + [1.0 if p[1] == d else 0.0 for d in domains] for p in train]
    coef = lstsq(rows, [p[2] for p in train])
    alpha, kappa = coef[0], dict(zip(domains, coef[1:]))
    test = run_means(lambda w: w != PUB, "commitment")
    by_cell = defaultdict(list)
    for m, n, y, cell in test:
        pred = alpha * m + kappa.get(n, float("nan"))
        by_cell[cell].append((pred, y))
    evaluation = {c: {"predicted": st.mean(p for p, _ in v), "measured": st.mean(y for _, y in v),
                      "rel_error": st.mean(p for p, _ in v) / st.mean(y for _, y in v) - 1} for c, v in by_cell.items()}
    return {"alpha_ms_per_wire": alpha, "kappa_ms": {str(k): v for k, v in kappa.items()}, "commitment_cells": evaluation}


def fit_time_model(points):
    """Least-squares fit of T = alpha*m + kappa_N to (wires, domain, time) points."""
    domains = sorted({p[1] for p in points})
    coef = lstsq([[p[0]] + [1.0 if p[1] == d else 0.0 for d in domains] for p in points], [p[2] for p in points])
    return coef[0], dict(zip(domains, coef[1:]))


def time_model_validation(runs, artifacts):
    """Checks of the time model beyond the fit itself (run means throughout).

    - Leave-one-depth-out: refit on the public cells without one depth and predict that
      depth. A depth that is alone in its domain cannot be predicted (its kappa is unknown).
    - Near replica: the commitment circuit at depth D has m_pub(D+1) - 7 wires. Of the
      measured public cells, only D = 13 is such a replica (of the commitment circuit at
      D = 12), so the D = 12 prediction is repeated without that cell.
    - Threshold ratio: the measured ratio of the pooled commitment proof time to the public
      one, per block, with a t interval; the predicted ratio with a block bootstrap interval
      (run means resampled with replacement within each public cell).
    - Proving alone: the same ratio for the proving step without witness generation."""
    pub = []
    for r in runs:
        if r["family"] == "DEPTH" and r["workflow"] == PUB:
            a = artifacts[r["configuration"]]["public"]
            pub.append((a["wires"], a["domainSize"], st.mean(proof_ms(b) for b in r["ballots"]), r["cellId"]))
    cells = sorted({p[3] for p in pub})
    lodo = {}
    for cell in cells:
        alpha, kappa = fit_time_model([p for p in pub if p[3] != cell])
        held = [p for p in pub if p[3] == cell]
        m, n, measured = held[0][0], held[0][1], st.mean(p[2] for p in held)
        if n not in kappa:
            lodo[cell] = {"identifiable": False}
            continue
        predicted = alpha * m + kappa[n]
        lodo[cell] = {"identifiable": True, "predicted": predicted, "measured": measured, "rel_error": predicted / measured - 1}
    errors = [v["rel_error"] for v in lodo.values() if v["identifiable"]]

    def commitment_cell(cell):
        rs = [r for r in runs if r["cellId"] == cell and r["workflow"] != PUB]
        a = artifacts[rs[0]["configuration"]]["commitment"]
        return a["wires"], a["domainSize"], st.mean(st.mean(proof_ms(b) for b in r["ballots"]) for r in rs)

    alpha, kappa = fit_time_model([p for p in pub if p[3] != "DEPTH-D13"])
    m, n, measured = commitment_cell("DEPTH-D12")
    replica = {"excluded_public_cell": "DEPTH-D13", "predicted": alpha * m + kappa[n], "measured": measured,
               "rel_error": (alpha * m + kappa[n]) / measured - 1}

    blocks = defaultdict(dict)
    for r in runs:
        if r["cellId"] == THRESHOLD_CELL:
            blocks[r["block"]][r["workflow"]] = r
    complete = [v for v in blocks.values() if set(v) == set(WORKFLOWS)]

    def run_mean(r, key=None):
        return st.mean((b[key] if key else proof_ms(b)) for b in r["ballots"])

    pooled = paired([(run_mean(v[PBR]) + run_mean(v[REV])) / 2 / run_mean(v[PUB]) for v in complete])
    prove_only = paired([run_mean(v[PBR], "proveMs") / run_mean(v[PUB], "proveMs") for v in complete])
    prove_ms = {NAMES[w]: st.mean(run_mean(v[w], "proveMs") for v in complete) for w in WORKFLOWS}

    cfg = complete[0][PUB]["configuration"]
    m_pub, n_pub = artifacts[cfg]["public"]["wires"], artifacts[cfg]["public"]["domainSize"]
    m_com, n_com = artifacts[cfg]["commitment"]["wires"], artifacts[cfg]["commitment"]["domainSize"]

    def predicted_ratio(points):
        a, k = fit_time_model(points)
        return (a * m_com + k[n_com]) / (a * m_pub + k[n_pub])

    by_cell = {c: [p for p in pub if p[3] == c] for c in cells}
    rng = random.Random(BOOTSTRAP_SEED)
    replicates = sorted(predicted_ratio([rng.choice(by_cell[c]) for c in cells for _ in by_cell[c]])
                        for _ in range(BOOTSTRAP_REPLICATES))
    return {
        "leave_one_depth_out": lodo,
        "lodo_rel_error_min": min(errors), "lodo_rel_error_max": max(errors),
        "lodo_rel_error_max_abs_D_ge_12": max(abs(v["rel_error"]) for c, v in lodo.items()
                                              if v["identifiable"] and int(c.split("D")[-1]) >= 12),
        "near_replica_D12": replica,
        "threshold": {
            "cell": THRESHOLD_CELL,
            "measured_ratio_pooled": pooled,
            "predicted_ratio": predicted_ratio(pub),
            "predicted_ratio_bootstrap_lo": replicates[int(0.025 * BOOTSTRAP_REPLICATES)],
            "predicted_ratio_bootstrap_hi": replicates[int(0.975 * BOOTSTRAP_REPLICATES) - 1],
            "bootstrap_replicates": BOOTSTRAP_REPLICATES, "bootstrap_seed": BOOTSTRAP_SEED,
            "prove_only_ratio_publisher": prove_only, "prove_ms_mean": prove_ms,
        },
    }


def memory_controls(runs):
    """The Reveal - Publisher memory contrast per cell, whose expected value is zero because
    both workflows prove the same circuit with the same key, and the absolute peak resident
    set size of the proving and baseline processes (cell means of run means, MiB)."""
    out, absolute, baseline = {}, [], []
    for cell in sorted({r["cellId"] for r in runs}):
        blocks = defaultdict(dict)
        for r in runs:
            if r["cellId"] == cell:
                blocks[r["block"]][r["workflow"]] = r
        complete = [v for v in blocks.values() if set(v) == set(WORKFLOWS)]

        def mib(r, field):
            return st.mean(m[field] for m in r["memory"]) / 2**20

        out[cell] = {
            "reveal_minus_publisher": paired([mib(v[REV], "deltaBytes") - mib(v[PBR], "deltaBytes") for v in complete]),
            "proving_peak_rss_MiB": {NAMES[w]: st.mean(mib(v[w], "proveBytes") for v in complete) for w in WORKFLOWS},
            "baseline_peak_rss_MiB": {NAMES[w]: st.mean(mib(v[w], "baselineBytes") for v in complete) for w in WORKFLOWS},
        }
        absolute += out[cell]["proving_peak_rss_MiB"].values()
        baseline += out[cell]["baseline_peak_rss_MiB"].values()
    means = [v["reveal_minus_publisher"]["mean"] for v in out.values()]
    return {"cells": out,
            "reveal_minus_publisher_positive_cells": sum(1 for x in means if x > 0), "cells_total": len(means),
            "reveal_minus_publisher_min": min(means), "reveal_minus_publisher_max": max(means),
            "reveal_minus_publisher_mean_of_cells": st.mean(means),
            "proving_peak_rss_min_MiB": min(absolute), "proving_peak_rss_max_MiB": max(absolute),
            "baseline_peak_rss_min_MiB": min(baseline), "baseline_peak_rss_max_MiB": max(baseline)}


def memory_vs_key(runs, artifacts):
    pts = []
    for r in runs:
        if r["family"] != "DEPTH":
            continue
        art = artifacts[r["configuration"]]["public" if r["workflow"] == PUB else "commitment"]
        mib = st.mean(m["deltaBytes"] for m in r["memory"]) / 2**20
        pts.append((art["zkeyBytes"] / 2**20, mib))
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    slope, intercept = lstsq([[x, 1.0] for x in xs], ys)
    mx, my = st.mean(xs), st.mean(ys)
    r = sum((x - mx) * (y - my) for x, y in pts) / math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    return {"slope_MiB_per_key_MiB": slope, "intercept_MiB": intercept, "pearson_r": r, "n_runs": len(pts)}


def result_phase(runs):
    out = defaultdict(dict)
    for cell in sorted({r["cellId"] for r in runs}):
        for wf in WORKFLOWS:
            rs = [r for r in runs if r["cellId"] == cell and r["workflow"] == wf]
            if not rs:
                continue
            gas = [r["result"]["resultGas"] for r in rs]
            ms = [r["result"]["resultMs"] for r in rs]
            b = rs[0]["plannedBallots"]
            out[cell][NAMES[wf]] = {"B": b, "C": rs[0]["candidates"], "gas_mean": st.mean(gas), "gas_per_ballot": st.mean(gas) / b,
                                    "ms_mean": st.mean(ms), "ms_sd": st.stdev(ms) if len(ms) > 1 else 0.0}
    # Marginal reveal cost across B (all cells with C = 4). The regression uses the
    # whole result phase (reveal batches + finalization), so that the break-even size
    # compares like with like: publication + freeze against reveal + finalization.
    rev4 = [r for r in runs if r["workflow"] == REV and r["candidates"] == 4]
    pts = [(r["plannedBallots"], r["result"]["resultGas"]) for r in rev4]
    pub = [r["result"]["resultGas"] for r in runs if r["workflow"] == PBR and r["candidates"] == 4]
    slope, intercept = lstsq([[b, 1.0] for b, _ in pts], [g for _, g in pts]) if len({b for b, _ in pts}) > 1 else (None, None)
    summary = {"reveal_marginal_gas_per_ballot": slope, "reveal_intercept_gas": intercept,
               "reveal_finalize_gas_C4": st.mean(r["result"]["finalizeGas"] for r in rev4),
               "publisher_result_gas_C4": st.mean(pub) if pub else None}
    if slope:
        summary["break_even_ballots"] = (summary["publisher_result_gas_C4"] - intercept) / slope
        summary["max_abs_rel_residual"] = max(abs((intercept + slope * b) / g - 1) for b, g in pts)
    # Reveal batches: the first batch of an election pays the first-write premiums of the
    # count slots; later batches are steady except when they open a new bitmap word.
    first = [r["result"]["revealBatchGas"][0] for r in rev4]
    later = [g for r in rev4 for g in r["result"]["revealBatchGas"][1:]]
    if later:
        steady = st.median(later)
        per_ballot = (steady - 21000) / 32  # batch size b = 32 in this design
        summary["reveal_batches"] = {
            "first_batch_gas_mean": st.mean(first), "later_batch_gas_median": steady,
            "later_batch_gas_min": min(later), "later_batch_gas_max": max(later),
            "in_batch_gas_per_ballot_upper": per_ballot,
            # EIP-7825 cap 2^24 per transaction; first batch also pays C first-write premiums
            "eip7825_max_ballots_per_batch": (2**24 - 21000 - 4 * 17100 - 2 * 17100) / per_ballot,
        }
    # Publisher result gas by C, restricted to runs in which every candidate received a vote.
    by_c = defaultdict(list)
    fin_c = defaultdict(list)
    for r in runs:
        if r["workflow"] == PBR and all(c > 0 for c in r["result"]["counts"]):
            by_c[r["candidates"]].append(r["result"]["resultGas"])
        if r["workflow"] == REV:
            fin_c[r["candidates"]].append(r["result"]["finalizeGas"])
    if len(by_c) > 1:
        cs = sorted(by_c)
        s_c, i_c = lstsq([[c, 1.0] for c in cs for _ in by_c[c]], [g for c in cs for g in by_c[c]])
        summary["publisher_by_C"] = {"means": {str(c): st.mean(by_c[c]) for c in cs},
                                     "gas_per_candidate": s_c, "intercept": i_c}
        summary["reveal_finalize_by_C"] = {str(c): st.mean(v) for c, v in sorted(fin_c.items())}
    return {"cells": dict(out), "summary": summary}


def time_model_median(runs, artifacts):
    """Sensitivity: the same model fitted on public run medians, evaluated on commitment run medians."""
    def pts(wf_filter, circuit):
        out = []
        for r in runs:
            if r["family"] != "DEPTH" or not wf_filter(r["workflow"]):
                continue
            art = artifacts[r["configuration"]][circuit]
            out.append((art["wires"], art["domainSize"], st.median(proof_ms(b) for b in r["ballots"]), r["cellId"]))
        return out
    train = pts(lambda w: w == PUB, "public")
    domains = sorted({p[1] for p in train})
    coef = lstsq([[p[0]] + [1.0 if p[1] == d else 0.0 for d in domains] for p in train], [p[2] for p in train])
    alpha, kappa = coef[0], dict(zip(domains, coef[1:]))
    by_cell = defaultdict(list)
    for m, n, y, cell in pts(lambda w: w != PUB, "commitment"):
        by_cell[cell].append((alpha * m + kappa[n], y))
    return {"alpha_ms_per_wire": alpha, "kappa_ms": {str(k): v for k, v in kappa.items()},
            "commitment_cells": {c: {"predicted": st.mean(p for p, _ in v), "measured": st.mean(y for _, y in v),
                                     "rel_error": st.mean(p for p, _ in v) / st.mean(y for _, y in v) - 1}
                                 for c, v in by_cell.items()}}


def fixed_costs(runs):
    """Deployment gas, election-creation gas (without the first-election premium), verification time, calldata."""
    setup = defaultdict(list)
    for r in runs:
        for k, v in r["setupGas"].items():
            setup[k].append(v)
    create = {NAMES[wf]: min(r["electionCreateGas"] for r in runs if r["workflow"] == wf) for wf in WORKFLOWS}
    verify = {c: st.median(b["verifyMs"] for r in runs if r["cellId"] == c for b in r["ballots"])
              for c in sorted({r["cellId"] for r in runs})}
    calldata = {NAMES[wf]: {"bytes": sorted({b["calldataBytes"] for r in runs if r["workflow"] == wf for b in r["ballots"]}),
                            "gas_mean": st.mean(b["calldataGas"] for r in runs if r["workflow"] == wf for b in r["ballots"])}
                for wf in WORKFLOWS}
    verifier_gas = sorted({r["verifierExecutionGas"] for r in runs})
    return {"setup_gas": {k: {"min": min(v), "max": max(v)} for k, v in setup.items()},
            "election_create_gas": create, "verify_ms_median_by_cell": verify,
            "calldata": calldata, "verifier_execution_gas_values": verifier_gas}


def per_block(runs):
    """Per-block run means and run medians of proof time per workflow, with the paired differences."""
    out = defaultdict(dict)
    for r in runs:
        t = [proof_ms(b) for b in r["ballots"]]
        entry = out[r["cellId"]].setdefault(str(r["block"]), {"order": {}})
        entry["order"][NAMES[r["workflow"]]] = r["orderPosition"]
        entry[NAMES[r["workflow"]]] = {"mean": st.mean(t), "median": st.median(t)}
    for cell, blocks in out.items():
        for blk, e in blocks.items():
            if all(NAMES[w] in e for w in WORKFLOWS):
                for stat in ("mean", "median"):
                    e[f"{stat}:Publisher-Public"] = e["Publisher"][stat] - e["Public"][stat]
                    e[f"{stat}:Reveal-Public"] = e["Reveal"][stat] - e["Public"][stat]
                    e[f"{stat}:Reveal-Publisher"] = e["Reveal"][stat] - e["Publisher"][stat]
    return out


def host_disturbances(runs):
    """Stalled ballots (> STALL_FACTOR x run median), the slowest ballot of the whole run,
    the effect of the stalls on each affected run mean, and the drift of the public run
    means within each cell in execution order."""
    stalled, slowest, stall_runs = [], (0.0, None), []
    for r in runs:
        t = [proof_ms(b) for b in r["ballots"]]
        med = st.median(t)
        mine = [x for x in t if x > STALL_FACTOR * med]
        for b, x in zip(r["ballots"], t):
            if x > STALL_FACTOR * med:
                stalled.append({"cell": r["cellId"], "block": r["block"], "workflow": NAMES[r["workflow"]], "ms": x})
            if x > slowest[0]:
                slowest = (x, f'{r["cellId"]} block {r["block"]} {NAMES[r["workflow"]]}')
        if mine:
            rest = [x for x in t if x <= STALL_FACTOR * med]
            stall_runs.append({"cell": r["cellId"], "block": r["block"], "workflow": NAMES[r["workflow"]],
                               "stalls_ms": sorted(mine, reverse=True), "run_mean": st.mean(t), "run_median": med,
                               "run_mean_without_stalls": st.mean(rest),
                               "longest_stall_share_of_mean": (max(mine) - med) / len(t)})
    total = sum(len(r["ballots"]) for r in runs)
    order = []
    for r in sorted(runs, key=lambda x: x["startedAt"]):
        if r["cellId"] not in order:
            order.append(r["cellId"])
    drift = {}
    for cell in order:
        seq = [st.mean(proof_ms(b) for b in r["ballots"])
               for r in sorted(runs, key=lambda x: x["startedAt"]) if r["cellId"] == cell and r["workflow"] == PUB]
        drift[cell] = {"public_run_means_in_order": seq, "first": seq[0], "last": seq[-1]}
    return {"stalled_ballots": len(stalled), "total_ballots": total, "stalls": stalled,
            "slowest_ballot_ms": slowest[0], "slowest_ballot_where": slowest[1],
            "stall_runs": sorted(stall_runs, key=lambda x: -x["run_mean"] + x["run_mean_without_stalls"]),
            "cell_execution_order": order, "public_drift_within_cell": drift}


# ---------------------------------------------------------------- report
def fmt(x, digits=1):
    return "—" if x is None else f"{x:,.{digits}f}"


def main():
    directory = Path(sys.argv[1])
    runs, artifacts = load(directory)
    result = {
        "population": population(runs),
        "gas": gas_decomposition(runs),
        "time": time_contrasts(runs),
        "time_model": time_model(runs, artifacts),
        "time_model_median": time_model_median(runs, artifacts),
        "time_model_validation": time_model_validation(runs, artifacts),
        "memory_vs_key": memory_vs_key(runs, artifacts),
        "memory_controls": memory_controls(runs),
        "result_phase": result_phase(runs),
        "fixed_costs": fixed_costs(runs),
        "host_disturbances": host_disturbances(runs),
        "per_block_proof_time": per_block(runs),
    }
    (directory / "analysis").mkdir(exist_ok=True)
    (directory / "analysis" / "paper_analysis.json").write_text(json.dumps(result, indent=2))

    md = ["# Paper analyses", "", "## Population", "", "| Cell | Blocks | Runs | Ballots |", "|---|---:|---:|---:|"]
    md += [f"| {c} | {v['blocks']} | {v['runs']} | {v['ballots']:,} |" for c, v in sorted(result["population"].items())]
    md += ["", "## Cast gas decomposition (gas per ballot)", "",
           "| Cell | Public steady | Publisher steady | Reveal steady | Pbr−Pub steady | First-ballot premium (Pub/Pbr/Rev) | New-candidate premium (Pub) | Max |model error| of mean diff |",
           "|---|---:|---:|---:|---:|---|---:|---:|"]
    for c, g in sorted(result["gas"].items()):
        md.append(f"| {c} | {fmt(g[PUB]['steady_mean'])} | {fmt(g[PBR]['steady_mean'])} | {fmt(g[REV]['steady_mean'])} | "
                  f"{fmt(g[PBR]['steady_mean'] - g[PUB]['steady_mean'])} | {fmt(g[PUB]['first_premium'],0)}/{fmt(g[PBR]['first_premium'],0)}/{fmt(g[REV]['first_premium'],0)} | "
                  f"{fmt(g[PUB]['new_candidate_premium'],0)} | {fmt(g['model_mean_diff_error']['max_abs'])} |")
    md += ["", "## Proof time: run means (primary) and run medians (sensitivity), ms", "",
           "| Cell | Stat | Public | Publisher | Reveal | Pbr−Pub [95% CI] | Rev−Pub [95% CI] | Rev−Pbr [95% CI] | Stalls (Pub/Pbr/Rev) |",
           "|---|---|---:|---:|---:|---|---|---|---|"]
    for c, t in sorted(result["time"].items()):
        for stat in ("mean", "median"):
            def ci(key):
                v = t[f"{stat}:{key}"]
                return f"{fmt(v['mean'])} [{fmt(v['lo'])}, {fmt(v['hi'])}] ×{v['ratio']:.3f}"
            s = t["stalls"]
            md.append(f"| {c} | {stat} | {fmt(t[f'{stat}:Public']['mean'])} | {fmt(t[f'{stat}:Publisher']['mean'])} | {fmt(t[f'{stat}:Reveal']['mean'])} | "
                      f"{ci('Publisher-Public')} | {ci('Reveal-Public')} | {ci('Reveal-Publisher')} | {s.get(PUB,0)}/{s.get(PBR,0)}/{s.get(REV,0)} |")
    tm = result["time_model"]
    md += ["", "## Proving-time model T = alpha*m + kappa(N), fitted on public DEPTH runs", "",
           f"alpha = {tm['alpha_ms_per_wire']:.5f} ms per wire; kappa(N) = " + ", ".join(f"{k}: {v:.1f} ms" for k, v in tm["kappa_ms"].items()), "",
           "| Commitment cell | Predicted (ms) | Measured (ms) | Relative error |", "|---|---:|---:|---:|"]
    md += [f"| {c} | {fmt(v['predicted'])} | {fmt(v['measured'])} | {v['rel_error']*100:+.1f}% |" for c, v in sorted(tm["commitment_cells"].items())]
    tmm = result["time_model_median"]
    md += ["", "### Sensitivity: the same model on run medians", "",
           f"alpha = {tmm['alpha_ms_per_wire']:.5f} ms per wire; kappa(N) = " + ", ".join(f"{k}: {v:.1f} ms" for k, v in tmm["kappa_ms"].items()), "",
           "| Commitment cell | Predicted (ms) | Measured (ms) | Relative error |", "|---|---:|---:|---:|"]
    md += [f"| {c} | {fmt(v['predicted'])} | {fmt(v['measured'])} | {v['rel_error']*100:+.1f}% |" for c, v in sorted(tmm["commitment_cells"].items())]
    tv = result["time_model_validation"]
    md += ["", "### Checks of the time model", "", "Leave-one-depth-out refits on the public cells:", "",
           "| Held-out public cell | Predicted (ms) | Measured (ms) | Relative error |", "|---|---:|---:|---:|"]
    md += [f"| {c} | {fmt(v['predicted'])} | {fmt(v['measured'])} | {v['rel_error']*100:+.1f}% |" if v["identifiable"]
           else f"| {c} | — | — | not identifiable (only cell in its domain) |" for c, v in sorted(tv["leave_one_depth_out"].items())]
    nr, th = tv["near_replica_D12"], tv["threshold"]
    mr, po = th["measured_ratio_pooled"], th["prove_only_ratio_publisher"]
    md += ["", f"Commitment circuit at D = 12 predicted without the public cell D = 13: {fmt(nr['predicted'])} ms against "
               f"{fmt(nr['measured'])} ms measured ({nr['rel_error']*100:+.1f}%)", "",
           f"Threshold ({th['cell']}): measured pooled ratio {mr['mean']:.4f} [{mr['lo']:.4f}, {mr['hi']:.4f}]; predicted "
           f"{th['predicted_ratio']:.4f} (block bootstrap 95% [{th['predicted_ratio_bootstrap_lo']:.4f}, "
           f"{th['predicted_ratio_bootstrap_hi']:.4f}], {th['bootstrap_replicates']} replicates); proving step alone, "
           f"Publisher over Public: {po['mean']:.3f} [{po['lo']:.3f}, {po['hi']:.3f}] "
           f"({fmt(th['prove_ms_mean']['Public'])} -> {fmt(th['prove_ms_mean']['Publisher'])} ms)"]
    mk = result["memory_vs_key"]
    md += ["", "## Proving memory against key size (DEPTH runs)", "",
           f"slope = {mk['slope_MiB_per_key_MiB']:.2f} MiB per MiB of key; intercept = {mk['intercept_MiB']:.1f} MiB; Pearson r = {mk['pearson_r']:.3f}; n = {mk['n_runs']} runs"]
    mc = result["memory_controls"]
    md += ["", "## Memory controls (MiB)", "",
           f"Reveal − Publisher (same circuit and key): positive in {mc['reveal_minus_publisher_positive_cells']} of "
           f"{mc['cells_total']} cells, range {mc['reveal_minus_publisher_min']:+.1f} to {mc['reveal_minus_publisher_max']:+.1f}, "
           f"mean of cells {mc['reveal_minus_publisher_mean_of_cells']:+.1f}; proving-process peak RSS "
           f"{mc['proving_peak_rss_min_MiB']:.0f}–{mc['proving_peak_rss_max_MiB']:.0f}; baseline peak RSS "
           f"{mc['baseline_peak_rss_min_MiB']:.0f}–{mc['baseline_peak_rss_max_MiB']:.0f}", "",
           "| Cell | Rev−Pbr [95% CI] | Peak RSS Pub/Pbr/Rev |", "|---|---|---|"]
    for c, v in sorted(mc["cells"].items()):
        d, p = v["reveal_minus_publisher"], v["proving_peak_rss_MiB"]
        md.append(f"| {c} | {d['mean']:+.1f} [{d['lo']:+.1f}, {d['hi']:+.1f}] | {p['Public']:.0f}/{p['Publisher']:.0f}/{p['Reveal']:.0f} |")
    rp = result["result_phase"]
    md += ["", "## Result phase", "", "| Cell | Workflow | B | C | Gas (mean) | Gas per ballot | Time ms (mean ± SD) |", "|---|---|---:|---:|---:|---:|---|"]
    for c, wfs in sorted(rp["cells"].items()):
        for w, v in wfs.items():
            md.append(f"| {c} | {w} | {v['B']} | {v['C']} | {fmt(v['gas_mean'],0)} | {fmt(v['gas_per_ballot'],0)} | {fmt(v['ms_mean'])} ± {fmt(v['ms_sd'])} |")
    s = rp["summary"]
    md += ["", f"Reveal result gas (batches + finalization, C = 4) regressed on B: {fmt(s.get('reveal_marginal_gas_per_ballot'))} gas per ballot; "
               f"intercept {fmt(s.get('reveal_intercept_gas'),0)} (finalization alone {fmt(s.get('reveal_finalize_gas_C4'),0)}); "
               f"largest relative residual {s.get('max_abs_rel_residual', 0)*100:.3f}%; publisher result gas (C = 4): {fmt(s.get('publisher_result_gas_C4'),0)}; "
               f"break-even election size: {fmt(s.get('break_even_ballots'))} ballots", ""]
    if "reveal_batches" in s:
        rb = s["reveal_batches"]
        md += [f"Reveal batches (b = 32): first batch {fmt(rb['first_batch_gas_mean'],0)} gas; later batches median {fmt(rb['later_batch_gas_median'],0)} "
               f"(range {fmt(rb['later_batch_gas_min'],0)}–{fmt(rb['later_batch_gas_max'],0)}); in-batch gas per ballot (upper bound) "
               f"{fmt(rb['in_batch_gas_per_ballot_upper'])}; EIP-7825 bound on ballots per batch: {fmt(rb['eip7825_max_ballots_per_batch'])}", ""]
    if "publisher_by_C" in s:
        pc = s["publisher_by_C"]
        md += ["Publisher result gas by C (runs with every candidate voted): " + ", ".join(f"C={c}: {fmt(v,0)}" for c, v in pc["means"].items())
               + f"; fit {fmt(pc['intercept'],0)} + {fmt(pc['gas_per_candidate'],0)}·C. Reveal finalization by C: "
               + ", ".join(f"C={c}: {fmt(v,0)}" for c, v in s["reveal_finalize_by_C"].items()), ""]
    fc = result["fixed_costs"]
    md += ["## Fixed costs, verification and calldata", "",
           "Deployment gas: " + "; ".join(f"{k} {fmt(v['min'],0)}" + ("" if v['min'] == v['max'] else f"–{fmt(v['max'],0)}") for k, v in fc["setup_gas"].items()), "",
           "Election creation (without first-election premium): " + ", ".join(f"{k} {fmt(v,0)}" for k, v in fc["election_create_gas"].items()), "",
           "Verifier execution gas values: " + ", ".join(f"{v:,}" for v in fc["verifier_execution_gas_values"]), "",
           "Off-chain verification, median per cell (ms): " + ", ".join(f"{c} {v:.2f}" for c, v in fc["verify_ms_median_by_cell"].items()), "",
           "Cast calldata: " + ", ".join(f"{k} {v['bytes']} bytes, {v['gas_mean']:.1f} gas" for k, v in fc["calldata"].items()), ""]
    hd = result["host_disturbances"]
    md += ["## Host disturbances", "",
           f"Stalled ballots (> {STALL_FACTOR:g}x run median): {hd['stalled_ballots']} of {hd['total_ballots']:,}; "
           f"slowest ballot {hd['slowest_ballot_ms']:,.0f} ms ({hd['slowest_ballot_where']})", ""]
    md += [f"- {x['cell']} block {x['block']} {x['workflow']}: {x['ms']:,.0f} ms" for x in hd["stalls"]]
    md += ["", "Effect of the stalls on their run means (ms):", ""]
    md += [f"- {x['cell']} block {x['block']} {x['workflow']}: stalls {', '.join(f'{s:,.0f}' for s in x['stalls_ms'])}; "
           f"run mean {x['run_mean']:,.1f}, without stalls {x['run_mean_without_stalls']:,.1f}, median {x['run_median']:,.1f}; "
           f"the longest stall alone adds {x['longest_stall_share_of_mean']:,.1f}" for x in hd["stall_runs"]]
    md += ["", "Public run means in execution order (ms), first and last block of each cell: "
           + "; ".join(f"{c} {v['first']:.1f} → {v['last']:.1f}" for c, v in hd["public_drift_within_cell"].items()), ""]
    md += ["", "## Per-block run medians of proof time: paired differences (ms)", "",
           "| Cell | Block | Order | Pbr−Pub | Rev−Pub | Rev−Pbr |", "|---|---:|---|---:|---:|---:|"]
    for cell, blocks in sorted(result["per_block_proof_time"].items()):
        for blk in sorted(blocks, key=int):
            e = blocks[blk]
            order = "".join(n[0] if n != "Publisher" else "B" for n, _ in sorted(e["order"].items(), key=lambda kv: kv[1]))
            md.append(f"| {cell} | {blk} | {order} | {e['median:Publisher-Public']:.1f} | {e['median:Reveal-Public']:.1f} | {e['median:Reveal-Publisher']:.1f} |")
    md.append("")
    (directory / "analysis" / "paper_tables.md").write_text("\n".join(md))
    print("\n".join(md))


if __name__ == "__main__":
    main()
