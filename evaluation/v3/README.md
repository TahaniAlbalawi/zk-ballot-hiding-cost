# Measurement harness

This directory holds the harness that produced every measurement in `data/`. Each matched block compares the three workflows:

| Workflow | Ballot on chain | Result |
|---|---|---|
| `PUBLIC_DISCLOSURE` (Public) | the vote itself | recomputed from `VoteCast` events |
| `COMMITMENT_BALLOT_HIDING` (Publisher) | Poseidon(vote, randomness) | openings reconciled off chain, then published by the configured publisher |
| `COMMITMENT_ONCHAIN_REVEAL` (Reveal) | Poseidon(vote, randomness) | openings revealed and checked on chain, then finalized |

The two commitment workflows cast identically. Their proof-time contrast is therefore an internal control and should be indistinguishable from zero.

## Files

| File | Purpose |
|---|---|
| `run_experiment.ts` | Runs a design: deploys, casts and finalizes every block, and appends the records to `runs.jsonl` and `ballots.csv` |
| `measure.ts` | Proof timing, verification timing, calldata gas, and the isolated memory measurement |
| `prover_child.mjs` | The isolated prover process whose peak memory is measured |
| `analyze.ts` | Absolute values, paired block contrasts with Holm adjustment, and the cost model against measurement |
| `designs/pilot.json` | Two cells (depths 5 and 13), 8 ballots, 3 blocks |
| `designs/full.json` | The design reported in the article |

## What is measured

**Proof timing.**
- Witness generation (`wtns.calculate`) and proving (`groth16.prove`) are timed separately.
- Nothing else runs in the process while proofs are timed.
- Two warm-up proofs precede each run.

**Peak prover memory** is measured at the end of each run, after the timed ballots and the result phase, in separate processes under `/usr/bin/time`. It is the peak of a proving run minus the peak of a run that only loads the same artifacts (`prover_child.mjs`).

**Blocks.**
- Each block starts from a fresh chain (`hardhat_reset`) with one deployment.
- Each workflow runs in its own election, with the same vote sequence.
- The order of the workflows cycles through all six permutations.

**Records.**
- **Per ballot:** witness, prove and verify time; cast gas; calldata bytes and gas; transaction latency.
- **Per run:** verifier execution gas (`eth_estimateGas` minus the base cost and calldata), result-phase gas and time, and prover memory.
- **Per configuration (`artifacts.json`):** constraints, wires, Groth16 domain size, and key and witness-generator sizes.
- **Per run directory (`environment-*.json`):** host, toolchain versions, the powers-of-tau hash, and a SHA-256 manifest of the circuit, contract, library and runner sources.

## Run

From the repository root, with circuits and contracts built (see the top-level README):

```bash
npm run experiment -- evaluation/v3/designs/pilot.json data/my-pilot
npm run analyze -- data/my-pilot
```

- **Local node.** The runner starts a local Hardhat node when none is listening on port 8545.
- **Resuming.** It appends one complete block at a time, so an interrupted run resumes at the first incomplete block.
- **Outputs.** `analyze.ts` writes `analysis/summary.json` and `analysis/tables.md` into the run directory.
