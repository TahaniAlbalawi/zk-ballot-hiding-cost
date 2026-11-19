#!/usr/bin/env python3
"""Independent cross-check of the experiment statistics.

Recomputes, from runs.jsonl alone, every paired contrast that the harness's
analysis script (evaluation/v3/analyze.ts) wrote to analysis/summary.json, and
the run-median contrasts that paper_analysis.py wrote to paper_analysis.json.

Independence from analyze.ts:
- different language (Python, standard library only);
- Student's t distribution from the exact finite-series formulas for integer
  degrees of freedom (Abramowitz and Stegun 26.7.3/26.7.4), not from the
  continued-fraction incomplete beta function that analyze.ts uses;
- quantiles by bisection on that series;
- its own aggregation, pairing by block and Holm step-down procedure.

Usage (from the repository root): python3 -I analysis/crosscheck_stats.py <experiment-dir>
Writes <experiment-dir>/analysis/crosscheck_report.md and exits non-zero on any mismatch.
"""
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

WORKFLOWS = {
    "public": "PUBLIC_DISCLOSURE",
    "publisher": "COMMITMENT_BALLOT_HIDING",
    "reveal": "COMMITMENT_ONCHAIN_REVEAL",
}
CONTRASTS = {
    "publisher-public": ("publisher", "public"),
    "reveal-public": ("reveal", "public"),
    "reveal-publisher": ("reveal", "publisher"),
}


def mean(values):
    return math.fsum(values) / len(values)


OUTCOMES = {
    "proofMs": lambda r: mean([b["witnessMs"] + b["proveMs"] for b in r["ballots"]]),
    "witnessMs": lambda r: mean([b["witnessMs"] for b in r["ballots"]]),
    "proveMs": lambda r: mean([b["proveMs"] for b in r["ballots"]]),
    "castGas": lambda r: mean([b["castGas"] for b in r["ballots"]]),
    "provingMemoryMiB": lambda r: mean([m["deltaBytes"] for m in r["memory"]]) / 2**20,
    "resultGasPerBallot": lambda r: r["result"]["resultGas"] / r["plannedBallots"],
    "resultMs": lambda r: r["result"]["resultMs"],
    "proofMsMedian": lambda r: statistics.median([b["witnessMs"] + b["proveMs"] for b in r["ballots"]]),
}


def t_central_probability(t: float, df: int) -> float:
    """P(|T| <= t) for Student's t with integer df (A&S 26.7.3 and 26.7.4)."""
    t = abs(t)
    theta = math.atan(t / math.sqrt(df))
    s, c = math.sin(theta), math.cos(theta)
    if df % 2 == 1:
        if df == 1:
            return 2 * theta / math.pi
        term, total = c, c
        for k in range(3, df - 1, 2):  # coefficients 2/3, (2*4)/(3*5), ...
            term *= c * c * (k - 1) / k
            total += term
        return 2 / math.pi * (theta + s * total)
    term, total = 1.0, 1.0
    for k in range(2, df - 1, 2):  # coefficients 1/2, (1*3)/(2*4), ...
        term *= c * c * (k - 1) / k
        total += term
    return s * total


def two_sided_p(t: float, df: int) -> float:
    return max(0.0, 1.0 - t_central_probability(t, df))


def t_critical(df: int, level: float = 0.95) -> float:
    low, high = 0.0, 1000.0
    for _ in range(200):
        mid = (low + high) / 2
        if t_central_probability(mid, df) < level:
            low = mid
        else:
            high = mid
    return (low + high) / 2


def holm(p_values):
    order = sorted(range(len(p_values)), key=lambda i: p_values[i])
    adjusted, running = [0.0] * len(p_values), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(p_values) - rank) * p_values[i]))
        adjusted[i] = running
    return adjusted


def paired(differences):
    n = len(differences)
    m = mean(differences)
    sd = statistics.stdev(differences)
    half = t_critical(n - 1) * sd / math.sqrt(n)
    if sd == 0:
        p = 1.0 if m == 0 else 0.0
    else:
        p = two_sided_p(m / (sd / math.sqrt(n)), n - 1)
    return {"n": n, "mean": m, "ciLow": m - half, "ciHigh": m + half, "p": p}


def contrast_rows(runs, contrast, outcome):
    left_name, right_name = CONTRASTS[contrast]
    by = defaultdict(dict)
    for r in runs:
        by[(r["cellId"], r["workflow"])][r["block"]] = r
    cells = list(dict.fromkeys(r["cellId"] for r in runs))
    rows = []
    for cell in cells:
        left = by[(cell, WORKFLOWS[left_name])]
        right = by[(cell, WORKFLOWS[right_name])]
        blocks = [b for b in left if b in right]
        f = OUTCOMES[outcome]
        diffs = [f(left[b]) - f(right[b]) for b in blocks]
        ratios = [f(left[b]) / f(right[b]) for b in blocks if f(right[b]) != 0]
        row = {"cellId": cell, **paired(diffs)}
        row["meanRatio"] = mean(ratios) if ratios else float("nan")
        rows.append(row)
    for row, adj in zip(rows, holm([row["p"] for row in rows])):
        row["holmP"] = adj
    return rows


def close(a, b, rel=1e-6, abs_tol=1e-6):
    if isinstance(a, float) and math.isnan(a) and (b is None or (isinstance(b, float) and math.isnan(b))):
        return True
    if b is None:
        return False
    return math.isclose(a, b, rel_tol=rel, abs_tol=abs_tol)


def main() -> None:
    out_dir = Path(sys.argv[1])
    runs = [json.loads(line) for line in (out_dir / "runs.jsonl").read_text().splitlines() if line.strip()]
    summary = json.loads((out_dir / "analysis" / "summary.json").read_text())
    paper = json.loads((out_dir / "analysis" / "paper_analysis.json").read_text())

    lines = ["# Independent cross-check of the reported statistics", ""]
    lines.append(f"t quantiles used: df=5 -> {t_critical(5):.7f}, df=11 -> {t_critical(11):.7f} "
                 "(reference values 2.5705818 and 2.2009852)")
    lines.append("")
    assert abs(t_critical(5) - 2.5705818) < 1e-6 and abs(t_critical(11) - 2.2009852) < 1e-6

    # A. Every contrast in summary.json (analyze.ts).
    reported = defaultdict(list)
    for row in summary["contrasts"]:
        reported[(row["contrast"], row["outcome"])].append(row)
    mismatches, checked, worst = [], 0, defaultdict(float)
    for (contrast, outcome), rows in reported.items():
        mine = {row["cellId"]: row for row in contrast_rows(runs, contrast, outcome)}
        for row in rows:
            ours = mine[row["cellId"]]
            checked += 1
            for key in ("mean", "ciLow", "ciHigh", "meanRatio"):
                if not close(ours[key], row.get(key)):
                    mismatches.append((contrast, outcome, row["cellId"], key, ours[key], row.get(key)))
                elif row.get(key) is not None:
                    worst[key] = max(worst[key], abs(ours[key] - row[key]))
            # p-values: compare where both are representable; tiny p-values lose digits in 1 - A(t).
            for key in ("p", "holmP"):
                a, b = ours[key], row[key]
                ok = math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-9) or (a < 1e-9 and b < 1e-9)
                if not ok:
                    mismatches.append((contrast, outcome, row["cellId"], key, a, b))
                else:
                    worst[key] = max(worst[key], abs(a - b))
    lines.append(f"## A. Harness analysis (summary.json): {checked} contrast rows checked")
    lines.append("")
    lines.append("Largest absolute discrepancy per quantity: " +
                 ", ".join(f"{k} {v:.3g}" for k, v in sorted(worst.items())))
    lines.append("")

    # B. Run-median contrasts of proof time (paper_analysis.py).
    names = {"Publisher-Public": "publisher-public", "Reveal-Public": "reveal-public", "Reveal-Publisher": "reveal-publisher"}
    checked_b, worst_b = 0, 0.0
    for label, contrast in names.items():
        mine = {row["cellId"]: row for row in contrast_rows(runs, contrast, "proofMsMedian")}
        for cell, entry in paper["time"].items():
            reported_row = entry[f"median:{label}"]
            ours = mine[cell]
            checked_b += 1
            for key_ours, key_rep in (("mean", "mean"), ("ciLow", "lo"), ("ciHigh", "hi"), ("meanRatio", "ratio")):
                # paper_analysis.py uses three-decimal t quantiles, so allow a relative 1e-3 on interval ends.
                tol = 1e-3 if key_rep in ("lo", "hi") else 1e-9
                diff = abs(ours[key_ours] - reported_row[key_rep])
                scale = max(1.0, abs(ours[key_ours] - ours["mean"])) if key_rep in ("lo", "hi") else max(1.0, abs(ours[key_ours]))
                if diff > tol * scale:
                    mismatches.append((contrast, "proofMsMedian", cell, key_rep, ours[key_ours], reported_row[key_rep]))
                worst_b = max(worst_b, diff)
    lines.append(f"## B. Run-median proof-time contrasts (paper_analysis.json): {checked_b} rows checked")
    lines.append("")
    lines.append(f"Largest absolute discrepancy: {worst_b:.3g} ms (interval ends differ only through the "
                 "three-decimal t quantiles used by paper_analysis.py)")
    lines.append("")

    # C. Integrity of the population: complete blocks, identical votes across arms,
    # and result counts equal to the tally of the cast votes in every run.
    blocks = defaultdict(dict)
    for r in runs:
        blocks[(r["cellId"], r["block"])][r["workflow"]] = r
    problems = []
    for key, arms in blocks.items():
        if set(arms) != set(WORKFLOWS.values()):
            problems.append((key, "missing workflow"))
            continue
        if len({tuple(b["vote"] for b in r["ballots"]) for r in arms.values()}) != 1:
            problems.append((key, "vote sequences differ between workflows"))
        for wf, r in arms.items():
            tally = [0] * r["candidates"]
            for b in r["ballots"]:
                tally[b["vote"]] += 1
            if len(r["ballots"]) != r["plannedBallots"]:
                problems.append((key, wf, "ballots missing"))
            if tally != list(r["result"]["counts"]):
                problems.append((key, wf, "result counts differ from cast votes"))
            if r["result"].get("unrevealed", 0) != 0:
                problems.append((key, wf, "unrevealed commitments"))
    lines.append(f"## C. Population integrity: {len(blocks)} blocks, {len(runs)} runs, "
                 f"{sum(len(r['ballots']) for r in runs):,} ballots")
    lines.append("")
    lines.append("Every block has all three workflows with identical vote sequences, every run cast all planned "
                 "ballots, and every result phase reproduced the tally of the cast votes." if not problems
                 else f"{len(problems)} integrity problems: {problems}")
    lines.append("")
    mismatches.extend(problems)

    lines.append("## Result")
    lines.append("")
    if mismatches:
        lines.append(f"{len(mismatches)} mismatches:")
        for m in mismatches:
            lines.append(f"- {m}")
    else:
        lines.append("No mismatches: every mean, interval, mean ratio, p-value and Holm-adjusted p-value agrees.")
    report = "\n".join(lines) + "\n"
    (out_dir / "analysis" / "crosscheck_report.md").write_text(report)
    print(report)
    sys.exit(1 if mismatches else 0)


if __name__ == "__main__":
    main()
