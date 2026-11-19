# Measurements

All measurements were taken on one machine (Apple M1 Pro, 10 cores, 16 GiB, macOS 26.5.2) with the toolchain listed in the top-level README. Times are wall-clock milliseconds from `process.hrtime`. Gas is in gas units, sizes in bytes, and timestamps in UTC.

## Directories

| Directory | Contents |
|---|---|
| `full-2026-11/` | The experiment reported in the article. It ran from 2026-11-11 18:30 to 2026-11-12 00:46 UTC: 114 blocks, 342 runs and 39,168 ballots, with no failed or repeated runs. |
| `pilot-2026-11-11/` | The pilot cited in the article: depths 5 and 13, 8 ballots, 3 blocks. It used exactly the same sources as the full run; compare the source manifests in the two `environment-*.json` files. |

## Files in each directory

| File | Contents |
|---|---|
| `design.json` | The experiment design: cells, blocks, seed, warm-up proofs, memory samples per run, and reveal batch size. The full run used `evaluation/v3/designs/full.json`. |
| `artifacts.json` | One entry per configuration and circuit: constraints, wires, public inputs, outputs, Groth16 domain size, and proving-key and witness-generator sizes. |
| `environment-<ms>.json` | Host and toolchain versions, the SHA-256 of the powers-of-tau file, and a SHA-256 manifest of every source file (circuits, contracts, library, runner and generated verifiers). It is written when the run starts; `<ms>` is the start time in Unix milliseconds. |
| `runs.jsonl` | One JSON object per run (schema `ZKV-RUN-v3`); see below. |
| `ballots.csv` | One row per ballot: the per-ballot values of `runs.jsonl`, flattened. |
| `run.log` | The runner's progress log. One absolute path in its last line was replaced by the repository-relative path. |
| `analysis/` | Analysis outputs (the pilot has only the first two files). |

The analysis outputs are:
- `summary.json` and `tables.md`, written by `evaluation/v3/analyze.ts`. They hold absolute values, paired contrasts with Holm adjustment, and the cost model.
- `paper_analysis.json` and `paper_tables.md`, written by `analysis/paper_analysis.py`.
- `paper_numbers.json`, written by `analysis/make_paper_tables.py`. It holds the numbers quoted in the article.
- `crosscheck_report.md`, written by `analysis/crosscheck_stats.py`.

## Design

Each block deploys fresh contracts on a reset chain and runs the three workflows in turn, each in its own election, with the same sequence of votes.
- **Order.** The order of the workflows cycles through all six permutations.
- **Cells and families.**
  - `DEPTH`: depths 5, 8, 10, 12, 13, 16 and 20 with C = 4 and B = 32, 12 blocks.
  - `CANDIDATES`: C = 2 and 8 at depth 10, 6 blocks.
  - `SCALE`: B = 128, 512 and 1024 at depth 16 with 1024 enrolled voters, 6 blocks.

## `runs.jsonl`

### Top-level fields

| Field | Meaning |
|---|---|
| `cellId`, `family`, `configuration` | Cell of the design (for example `DEPTH-D13`), its family, and the circuit configuration (`D13-C04`: depth 13, 4 candidates) |
| `depth`, `candidates`, `electorate`, `plannedBallots` | Merkle depth D, number of candidates C, enrolled credentials, and ballots cast B |
| `block`, `orderPosition` | Block number (from 1) and the position of this workflow within its block (1–3) |
| `workflow` | `PUBLIC_DISCLOSURE` (Public), `COMMITMENT_BALLOT_HIDING` (Publisher) or `COMMITMENT_ONCHAIN_REVEAL` (Reveal) |
| `electionCreateGas` | Gas of the transaction that created the election |
| `verifierExecutionGas` | `eth_estimateGas` of one `verifyProof` call, minus the 21,000 base cost and its calldata gas |
| `setupGas` | Deployment gas of the block's contracts: `registry`, `verifierPublic`, `verifierCommitment`, `ballotBox`, `setVerifierPrivate`, `poseidonHasher` and `setCommitmentHasher`. All three runs of a block share one deployment, so these values repeat. |
| `startedAt`, `endedAt` | Start and end of the run |

### `ballots[]`, one entry per ballot in casting order

| Field | Meaning |
|---|---|
| `index`, `vote` | Position in the run (from 0) and the chosen candidate (from 0) |
| `witnessMs` | Witness generation (`snarkjs.wtns.calculate`) |
| `proveMs` | Groth16 proving (`snarkjs.groth16.prove`). Proof time in the article is `witnessMs + proveMs`. |
| `verifyMs` | Off-chain verification (`snarkjs.groth16.verify`) |
| `castGas` | `gasUsed` of the cast transaction |
| `calldataBytes`, `calldataGas` | Calldata length, and its cost at 4 gas per zero byte and 16 per nonzero byte (EIP-2028) |
| `txMs` | Time from sending the cast transaction to receiving its receipt from the local node |

### `memory[]`, peak resident set size of isolated prover processes run under `/usr/bin/time`

| Field | Meaning |
|---|---|
| `baselineBytes` | A process that loads Node.js, snarkjs and the circuit's witness generator and key, without proving |
| `proveBytes` | The same process, which also generates a witness and a proof |
| `deltaBytes` | `proveBytes − baselineBytes`. This is the proving memory reported in the article (mean of the samples, in MiB). |

### `result`, the result phase

| Workflow | Fields |
|---|---|
| Public | `counts`, `events` (`VoteCast` events read), `recomputeMs`, `resultMs` (equal to `recomputeMs`), `resultGas` (0) |
| Publisher | `counts`, `reconcileMs` (off-chain reconciliation of the openings), `publishMs` and `publishGas` (publication transaction), `finalizeMs` and `finalizeGas` (freeze transaction), `resultMs` (their sum), `resultGas` (`publishGas + finalizeGas`) |
| Reveal | `counts`, `revealBatches`, `revealBatchGas` (gas of each batch transaction, at most 32 openings per batch), `revealGas` (their sum), `revealMs`, `finalizeMs`, `finalizeGas`, `resultMs` (`revealMs + finalizeMs`), `resultGas` (`revealGas + finalizeGas`), and `unrevealed` (commitments left unrevealed; 0 in every run) |

In every run, `counts` equals the tally of the votes cast. `analysis/crosscheck_stats.py` checks this.
