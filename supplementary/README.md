# Supplementary Tables S1–S7

These tables accompany the article *What Does Hiding the Ballot Cost? Information Symmetry and Trust in Zero-Knowledge Voting on Ethereum*.

`analysis/make_supplementary.py` generates them from the measurements in `data/full-2026-11/` and from the circuit artifacts archived on Zenodo; every value is copied or computed from these inputs.
- Files are comma-separated, UTF-8, with a header row.
- Numbers are at full precision. An empty field means "not applicable".
- Workflows are named as in the article (Public, Publisher, Reveal). The column `workflow_id` gives the identifier used in the code and raw data.

Common units:
- times in milliseconds (wall clock);
- gas in gas units;
- sizes in bytes;
- memory in MiB (2^20 bytes).

## Table S1: Circuit artifacts (`TableS1_circuit_artifacts.csv`)

There is one row per generated proving key: 12 configurations × 2 circuits = 24 keys. Eighteen keys (9 configurations) were used in the experiment.

| Column | Meaning |
|---|---|
| `configuration`, `depth`, `candidates` | Configuration (for example `D13-C04`), Merkle depth D and candidate bound C |
| `circuit` | `public` (Public workflow) or `commitment` (Publisher and Reveal) |
| `used_in_experiment` | Whether the experiment used this configuration |
| `constraints`, `wires`, `public_inputs`, `private_inputs` | From the R1CS header |
| `domain_size`, `coefficients` | Groth16 evaluation-domain size N and nonzero constraint coefficients q, from the proving-key header |
| `zkey_bytes`, `zkey_bytes_model`, `zkey_model_residual_bytes` | Proving-key size, the size predicted by the key-size equation of the article, and their difference (0 for every key) |
| `wasm_bytes`, `r1cs_bytes`, `verification_key_bytes` | Sizes of the witness generator, the R1CS file and the verification key |
| `zkey_sha256`, `verifier_contract` | SHA-256 of the proving key and the name of its generated Solidity verifier |

## Table S2: Runs (`TableS2_runs.csv`)

There is one row per run: 114 blocks × 3 workflows = 342 runs. Columns ending in `_mean`, `_median`, `_min` or `_max` summarize the run's ballots, or its memory samples.

| Column | Meaning |
|---|---|
| `cell`, `family`, `configuration`, `depth`, `candidates`, `electorate`, `ballots` | Design cell and its parameters (ballots = B) |
| `block`, `workflow`, `workflow_id`, `order_position` | Block (from 1), workflow, and the workflow's position in the block (1–3) |
| `started_at`, `ended_at` | Start and end of the run (UTC) |
| `election_create_gas` | Gas of the election-creation transaction |
| `verifier_execution_gas` | Execution gas of one `verifyProof` call (without base cost and calldata) |
| `proof_ms_mean`, `proof_ms_median` | Proof time per ballot (witness generation + proving) |
| `witness_ms_mean`, `prove_ms_mean`, `verify_ms_mean` | Witness generation, Groth16 proving, and off-chain verification |
| `tx_ms_mean` | Time from sending a cast transaction to its receipt |
| `cast_gas_mean`, `cast_gas_min`, `cast_gas_max` | Gas of the cast transactions |
| `calldata_bytes_mean`, `calldata_gas_mean` | Calldata length and its gas (EIP-2028) |
| `memory_samples` | Number of isolated memory measurements (3) |
| `prove_peak_rss_mib_mean`, `baseline_peak_rss_mib_mean` | Peak resident set size of the proving process and of the load-only baseline process |
| `proving_memory_mib_mean` | Their difference: the proving memory reported in the article |
| `result_gas`, `result_ms`, `result_gas_per_ballot` | Total gas and time of the result phase, and gas divided by B |
| `reconcile_ms`, `publish_ms`, `publish_gas` | Publisher only: off-chain reconciliation, and the publication transaction |
| `finalize_ms`, `finalize_gas` | Publisher and Reveal: the freeze or finalization transaction |
| `reveal_batches`, `reveal_gas`, `reveal_ms`, `unrevealed` | Reveal only: batch transactions, their total gas and time, and commitments left unrevealed (0 in every run) |
| `events`, `recompute_ms` | Public only: `VoteCast` events read and the off-chain recount |
| `result_counts` | Final counts per candidate, separated by semicolons. They equal the tally of the votes cast in every run. |
| `setup_*_gas` | Deployment gas of the block's contracts (shared by its three runs) |

## Table S3: Ballots (`TableS3_ballots.csv`)

There is one row per ballot (39,168 rows). This is a byte-for-byte copy of `data/full-2026-11/ballots.csv`.

| Column | Meaning |
|---|---|
| `cellId`, `configuration`, `depth`, `candidates`, `electorate`, `plannedBallots`, `block`, `workflow`, `orderPosition` | As in Table S2 (`workflow` holds the code identifier) |
| `index`, `vote` | Position of the ballot in its run (from 0) and the chosen candidate (from 0) |
| `witnessMs`, `proveMs`, `verifyMs` | Witness generation, proving and off-chain verification of this ballot's proof |
| `castGas`, `calldataBytes`, `calldataGas`, `txMs` | Gas, calldata and latency of this ballot's cast transaction |

## Table S4: Cell means (`TableS4_cell_means.csv`)

There is one row per cell, workflow and outcome: 12 cells × 3 workflows × 11 outcomes = 396 rows. Each value is the mean over blocks of the run-level outcome, with its standard deviation and 95% t-interval.

| Column | Meaning |
|---|---|
| `outcome`, `unit` | Times in ms: `proofMs`, `witnessMs`, `proveMs`, `verifyMs` and `resultMs`.<br>Gas: `castGas` and `resultGasPerBallot` (per ballot), and `verifierGas` (per proof).<br>Size: `calldataBytes` (bytes per ballot).<br>Memory in MiB: `proverPeakMiB` (peak of the proving process) and `provingMemoryMiB` (peak minus baseline). |
| `n_blocks`, `mean`, `sd`, `ci95_low`, `ci95_high` | Number of blocks, mean, standard deviation and 95% confidence interval |

## Table S5: Paired contrasts (`TableS5_paired_contrasts.csv`)

The table has 180 rows: 144 primary contrasts and 36 sensitivity contrasts. Each contrast is a paired difference over blocks. Contrasts are named as differences between workflows: `Publisher-Public`, `Reveal-Public` and `Reveal-Publisher`.

The `statistic` column distinguishes the two kinds of rows:
- `run mean`: the primary analysis. These rows cover 12 families of one contrast and one outcome, each over the 12 cells:
  - `Publisher-Public`: `proofMs`, `witnessMs`, `proveMs`, `castGas` and `provingMemoryMiB`;
  - `Reveal-Public`: `proofMs`, `castGas` and `resultGasPerBallot`;
  - `Reveal-Publisher`: `proofMs`, `castGas`, `resultGasPerBallot` and `resultMs`.
- `run median`: the sensitivity analysis of proof time. It uses the median of each run instead of its mean. Its intervals use t quantiles rounded to three decimals, and no p-values are computed.

Columns:
- `n_blocks`, `mean_difference`, `sd_difference`, `ci95_low`, `ci95_high`, `t`, `p`: paired t statistics over blocks.
- `holm_p`: the p-value adjusted with Holm's method within each family of 12 cells (one contrast and one outcome).
- `mean_ratio`: the mean over blocks of the ratio of the two run-level values.

## Table S6: Reveal batches (`TableS6_reveal_batches.csv`)

There is one row per reveal batch transaction (408 rows). Columns: `cell`, `depth`, `candidates`, `ballots`, `block`, `batch` (from 1), `ballots_in_batch` (at most 32), `gas` and `gas_per_ballot`. The first batch of each election also pays the first-write premiums of the count slots, the bitmap word and the revealed total.

## Table S7: Time model (`TableS7_time_model.csv`)

The table gives out-of-sample proof-time predictions for the commitment circuits, for the seven `DEPTH` cells and two fits.

The model is T = α·m + κ(N), where m is the number of wires and N the domain size. It is fitted on the Public runs of the `DEPTH` family:
- `run mean` fits run means and is the primary fit;
- `run median` fits run medians and is the sensitivity fit.

Columns:
- `alpha_ms_per_wire`, `kappa_ms_for_domain`: the fitted coefficients.
- `commitment_wires`, `commitment_domain`: m and N of the commitment circuit.
- `predicted_ms`, `measured_ms`: the prediction, and the measured mean over the Publisher and Reveal runs of the cell.
- `relative_error`: predicted divided by measured, minus one.
