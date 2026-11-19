#!/usr/bin/env python3
"""Write the supplementary tables (Tables S1-S7) as CSV files.

Usage: python3 -I analysis/make_supplementary.py <experiment-dir> <configurations-dir> <output-dir>

Inputs
  <experiment-dir>      a v3 experiment directory: runs.jsonl, ballots.csv, design.json,
                        artifacts.json, analysis/summary.json (evaluation/v3/analyze.ts) and
                        analysis/paper_analysis.json (analysis/paper_analysis.py)
  <configurations-dir>  circuits/build/configurations, the generated circuit bundles (Table S1 only)

Outputs (in <output-dir>)
  TableS1_circuit_artifacts.csv   one row per generated proving key
  TableS2_runs.csv                one row per run
  TableS3_ballots.csv             one row per ballot (a byte-for-byte copy of ballots.csv)
  TableS4_cell_means.csv          absolute values per cell, workflow and outcome
  TableS5_paired_contrasts.csv    paired block contrasts with 95% CIs and Holm-adjusted p-values
  TableS6_reveal_batches.csv      gas of every reveal batch
  TableS7_time_model.csv          out-of-sample proof-time predictions for the commitment circuits

Standard library only. Every value is copied or computed from the inputs; nothing is typed by hand.
"""
import csv
import json
import os
import shutil
import statistics as st
import struct
import sys
from pathlib import Path

LABEL = {"PUBLIC_DISCLOSURE": "Public", "COMMITMENT_BALLOT_HIDING": "Publisher",
         "COMMITMENT_ONCHAIN_REVEAL": "Reveal"}
CONTRAST = {"publisher-public": "Publisher-Public", "reveal-public": "Reveal-Public",
            "reveal-publisher": "Reveal-Publisher"}
MIB = 2 ** 20
# Bytes of a snarkjs Groth16 zkey that do not depend on the circuit (header and fixed points);
# the key-size equation of Section 4 adds this constant to the variable part below.
ZKEY_FIXED_BYTES = 1292
RESULT_KEYS = ["resultGas", "resultMs", "reconcileMs", "publishMs", "publishGas", "finalizeMs",
               "finalizeGas", "revealBatches", "revealGas", "revealMs", "unrevealed", "events",
               "recomputeMs"]
SETUP_KEYS = ["registry", "verifierPublic", "verifierCommitment", "ballotBox", "setVerifierPrivate",
              "poseidonHasher", "setCommitmentHasher"]


def snake(name: str) -> str:
    return "".join("_" + c.lower() if c.isupper() else c for c in name)


def write_csv(path: Path, header: list[str], rows: list[list]) -> None:
    with path.open("w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        for row in rows:
            if len(row) != len(header):
                sys.exit(f"{path.name}: row has {len(row)} fields, header has {len(header)}")
            w.writerow(["" if v is None else v for v in row])
    print(f"wrote {path} ({len(rows)} rows)")


def sections(f, magic: bytes) -> dict[int, tuple[int, int]]:
    if f.read(4) != magic:
        raise ValueError(f"{f.name}: not a {magic.decode()} file")
    _version, count = struct.unpack("<II", f.read(8))
    found = {}
    for _ in range(count):
        kind, size = struct.unpack("<IQ", f.read(12))
        found.setdefault(kind, (f.tell(), size))
        f.seek(size, os.SEEK_CUR)
    return found


def r1cs_header(path: Path) -> dict:
    with path.open("rb") as f:
        start, _ = sections(f, b"r1cs")[1]
        f.seek(start)
        (n8,) = struct.unpack("<I", f.read(4))
        f.seek(n8, os.SEEK_CUR)
        wires, pub_out, pub_in, prv_in = struct.unpack("<IIII", f.read(16))
        (_labels,) = struct.unpack("<Q", f.read(8))
        (constraints,) = struct.unpack("<I", f.read(4))
    return {"wires": wires, "outputs": pub_out, "public_inputs": pub_in, "private_inputs": prv_in,
            "constraints": constraints}


def zkey_header(path: Path) -> dict:
    with path.open("rb") as f:
        found = sections(f, b"zkey")
        f.seek(found[2][0])
        (n8q,) = struct.unpack("<I", f.read(4))
        f.seek(n8q, os.SEEK_CUR)
        (n8r,) = struct.unpack("<I", f.read(4))
        f.seek(n8r, os.SEEK_CUR)
        n_vars, n_public, domain = struct.unpack("<III", f.read(12))
        f.seek(found[4][0])
        (n_coefs,) = struct.unpack("<I", f.read(4))
    return {"n_vars": n_vars, "n_public": n_public, "domain": domain, "n_coefs": n_coefs}


def zkey_model_bytes(h: dict) -> int:
    v, p, n, q = h["n_vars"], h["n_public"], h["domain"], h["n_coefs"]
    return ZKEY_FIXED_BYTES + 64 * (p + 1) + 4 + 44 * q + 256 * v + 64 * (v - p - 1) + 64 * n


def table_s1(configurations: Path, used: set[str]) -> tuple[list[str], list[list]]:
    header = ["configuration", "depth", "candidates", "circuit", "used_in_experiment", "constraints",
              "wires", "public_inputs", "private_inputs", "domain_size", "coefficients", "zkey_bytes",
              "zkey_bytes_model", "zkey_model_residual_bytes", "wasm_bytes", "r1cs_bytes",
              "verification_key_bytes", "zkey_sha256", "verifier_contract"]
    rows = []
    for bundle in sorted(configurations.glob("*/*/configuration-artifact-manifest.json")):
        m = json.loads(bundle.read_text())
        base = bundle.parent
        files = {k: v for k, v in m["files"].items()}
        r1cs = r1cs_header(base / files["r1cs"]["relative_path"])
        zkey_path = base / files["zkey"]["relative_path"]
        z = zkey_header(zkey_path)
        if z["n_vars"] != r1cs["wires"] or z["n_public"] != r1cs["public_inputs"] + r1cs["outputs"]:
            sys.exit(f"{zkey_path}: zkey header disagrees with the r1cs header")
        size = zkey_path.stat().st_size
        model = zkey_model_bytes(z)
        rows.append([m["configuration_id"], m["merkle_depth_d"], m["candidate_count_c"], base.name,
                     "yes" if m["configuration_id"] in used else "no", r1cs["constraints"], r1cs["wires"],
                     r1cs["public_inputs"], r1cs["private_inputs"], z["domain"], z["n_coefs"], size, model,
                     size - model, files["wasm"]["byte_size"], files["r1cs"]["byte_size"],
                     files["verification_key"]["byte_size"], files["zkey"]["sha256"], m["contract_name"]])
    return header, rows


def table_s2(runs: list[dict]) -> tuple[list[str], list[list]]:
    header = ["cell", "family", "configuration", "depth", "candidates", "electorate", "ballots", "block",
              "workflow", "workflow_id", "order_position", "started_at", "ended_at",
              "election_create_gas", "verifier_execution_gas", "proof_ms_mean", "proof_ms_median",
              "witness_ms_mean", "prove_ms_mean", "verify_ms_mean", "tx_ms_mean", "cast_gas_mean",
              "cast_gas_min", "cast_gas_max", "calldata_bytes_mean", "calldata_gas_mean",
              "memory_samples", "prove_peak_rss_mib_mean", "baseline_peak_rss_mib_mean",
              "proving_memory_mib_mean"]
    header += [snake(k) for k in RESULT_KEYS] + ["result_gas_per_ballot", "result_counts"]
    header += [f"setup_{snake(k)}_gas" for k in SETUP_KEYS]
    rows = []
    for r in runs:
        b = r["ballots"]
        if len(b) != r["plannedBallots"]:
            sys.exit(f"{r['cellId']} block {r['block']}: incomplete run")
        proof = [x["witnessMs"] + x["proveMs"] for x in b]
        mem = r["memory"]
        res = r["result"]
        unknown = set(res) - set(RESULT_KEYS) - {"counts", "revealBatchGas"}
        if unknown:
            sys.exit(f"unexpected result fields: {sorted(unknown)}")
        if set(r["setupGas"]) != set(SETUP_KEYS):
            sys.exit(f"unexpected setup fields: {sorted(r['setupGas'])}")
        rows.append([
            r["cellId"], r["family"], r["configuration"], r["depth"], r["candidates"], r["electorate"],
            r["plannedBallots"], r["block"], LABEL[r["workflow"]], r["workflow"], r["orderPosition"],
            r["startedAt"], r["endedAt"], r["electionCreateGas"], r["verifierExecutionGas"],
            st.fmean(proof), st.median(proof), st.fmean(x["witnessMs"] for x in b),
            st.fmean(x["proveMs"] for x in b), st.fmean(x["verifyMs"] for x in b),
            st.fmean(x["txMs"] for x in b), st.fmean(x["castGas"] for x in b),
            min(x["castGas"] for x in b), max(x["castGas"] for x in b),
            st.fmean(x["calldataBytes"] for x in b), st.fmean(x["calldataGas"] for x in b),
            len(mem), st.fmean(m["proveBytes"] for m in mem) / MIB,
            st.fmean(m["baselineBytes"] for m in mem) / MIB, st.fmean(m["deltaBytes"] for m in mem) / MIB,
            *[res.get(k) for k in RESULT_KEYS], res["resultGas"] / r["plannedBallots"],
            ";".join(str(c) for c in res["counts"]),
            *[r["setupGas"][k] for k in SETUP_KEYS],
        ])
    return header, rows


def cell_info(runs: list[dict]) -> dict[str, list]:
    info = {}
    for r in runs:
        info.setdefault(r["cellId"], [r["family"], r["depth"], r["candidates"], r["plannedBallots"]])
    return info


def table_s4(summary: dict, info: dict) -> tuple[list[str], list[list]]:
    header = ["cell", "family", "depth", "candidates", "ballots", "workflow", "workflow_id", "outcome",
              "unit", "n_blocks", "mean", "sd", "ci95_low", "ci95_high"]
    rows = [[a["cellId"], *info[a["cellId"]], LABEL[a["workflow"]], a["workflow"], a["outcome"], a["unit"],
             a["n"], a["mean"], a["sd"], a["ciLow"], a["ciHigh"]] for a in summary["absolute"]]
    return header, rows


def table_s5(summary: dict, paper: dict, info: dict) -> tuple[list[str], list[list]]:
    header = ["cell", "family", "depth", "candidates", "ballots", "contrast", "outcome", "unit", "statistic",
              "n_blocks", "mean_difference", "sd_difference", "ci95_low", "ci95_high", "t", "p", "holm_p",
              "mean_ratio"]
    rows = [[c["cellId"], *info[c["cellId"]], CONTRAST[c["contrast"]], c["outcome"], c["unit"], "run mean",
             c["n"], c["mean"], c["sd"], c["ciLow"], c["ciHigh"], c["t"], c["p"], c["holmP"], c["meanRatio"]]
            for c in summary["contrasts"]]
    for cell, entry in paper["time"].items():
        for name in CONTRAST.values():
            m = entry[f"median:{name}"]
            rows.append([cell, *info[cell], name, "proofMs", "ms", "run median", m["n"], m["mean"], None,
                         m["lo"], m["hi"], None, None, None, m["ratio"]])
    return header, rows


def table_s6(runs: list[dict], batch_size: int) -> tuple[list[str], list[list]]:
    header = ["cell", "depth", "candidates", "ballots", "block", "batch", "ballots_in_batch", "gas",
              "gas_per_ballot"]
    rows = []
    for r in runs:
        if r["workflow"] != "COMMITMENT_ONCHAIN_REVEAL":
            continue
        gas = r["result"]["revealBatchGas"]
        if len(gas) != r["result"]["revealBatches"] or sum(gas) != r["result"]["revealGas"]:
            sys.exit(f"{r['cellId']} block {r['block']}: reveal batches do not add up")
        for i, g in enumerate(gas):
            n = min(batch_size, r["plannedBallots"] - i * batch_size)
            rows.append([r["cellId"], r["depth"], r["candidates"], r["plannedBallots"], r["block"], i + 1, n,
                         g, g / n])
    return header, rows


def table_s7(paper: dict, artifacts: list[dict], runs: list[dict]) -> tuple[list[str], list[list]]:
    header = ["cell", "depth", "fit", "alpha_ms_per_wire", "commitment_wires", "commitment_domain",
              "kappa_ms_for_domain", "predicted_ms", "measured_ms", "relative_error"]
    by_config = {a["configuration"]: a for a in artifacts}
    config_of = {r["cellId"]: r["configuration"] for r in runs}
    rows = []
    for fit, key in (("run mean", "time_model"), ("run median", "time_model_median")):
        model = paper[key]
        for cell, c in sorted(model["commitment_cells"].items(), key=lambda kv: by_config[config_of[kv[0]]]["depth"]):
            art = by_config[config_of[cell]]
            n = art["commitment"]["domainSize"]
            rows.append([cell, art["depth"], fit, model["alpha_ms_per_wire"], art["commitment"]["wires"], n,
                         model["kappa_ms"][str(n)], c["predicted"], c["measured"], c["rel_error"]])
    return header, rows


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    exp, configurations, out = (Path(a) for a in sys.argv[1:])
    out.mkdir(parents=True, exist_ok=True)
    runs = [json.loads(line) for line in (exp / "runs.jsonl").read_text().splitlines() if line.strip()]
    artifacts = json.loads((exp / "artifacts.json").read_text())
    design = json.loads((exp / "design.json").read_text())
    summary = json.loads((exp / "analysis" / "summary.json").read_text())
    paper = json.loads((exp / "analysis" / "paper_analysis.json").read_text())
    info = cell_info(runs)

    write_csv(out / "TableS1_circuit_artifacts.csv",
              *table_s1(configurations, {a["configuration"] for a in artifacts}))
    write_csv(out / "TableS2_runs.csv", *table_s2(runs))
    shutil.copyfile(exp / "ballots.csv", out / "TableS3_ballots.csv")
    print(f"wrote {out / 'TableS3_ballots.csv'} (copy of ballots.csv)")
    write_csv(out / "TableS4_cell_means.csv", *table_s4(summary, info))
    write_csv(out / "TableS5_paired_contrasts.csv", *table_s5(summary, paper, info))
    write_csv(out / "TableS6_reveal_batches.csv", *table_s6(runs, design["revealBatchSize"]))
    write_csv(out / "TableS7_time_model.csv", *table_s7(paper, artifacts, runs))


if __name__ == "__main__":
    main()
