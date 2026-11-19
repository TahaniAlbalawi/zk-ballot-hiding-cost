# Experiment analysis (2026-11-11T18:02:17.648Z)

Runs: 18; cells: P-D05, P-D13

## Absolute values (mean ± SD over blocks)

| Cell | Outcome | public | publisher | reveal |
|---|---|---|---|---|
| P-D05 | proofMs (ms) | 221 ± 18 | 225 ± 2.6 | 223 ± 1 |
| P-D05 | witnessMs (ms) | 30.3 ± 0.64 | 30.2 ± 0.26 | 30.4 ± 0.26 |
| P-D05 | proveMs (ms) | 191 ± 18 | 194 ± 2.6 | 193 ± 1.1 |
| P-D05 | verifyMs (ms) | 10.5 ± 0.24 | 10.7 ± 0.28 | 10.6 ± 0.028 |
| P-D05 | castGas (gas/ballot) | 308,934 ± 1,235 | 326,871 ± 8.3 | 326,943 ± 7.4 |
| P-D05 | calldataBytes (B/ballot) | 356 ± 0 | 356 ± 0 | 356 ± 0 |
| P-D05 | verifierGas (gas/proof) | 221,447 ± 0 | 221,447 ± 0 | 221,447 ± 0 |
| P-D05 | resultGasPerBallot (gas/ballot) | 0 ± 0 | 37,434 ± 1,437 | 66,050 ± 1,577 |
| P-D05 | resultMs (ms) | 32.9 ± 3.3 | 466 ± 140 | 426 ± 1.2 |
| P-D05 | proverPeakMiB (MiB) | 325 ± 1.1 | 340 ± 5.5 | 345 ± 0.53 |
| P-D05 | provingMemoryMiB (MiB) | 253 ± 0.84 | 266 ± 8.2 | 272 ± 1.9 |
| P-D13 | proofMs (ms) | 350 ± 3.4 | 479 ± 4.8 | 476 ± 19 |
| P-D13 | witnessMs (ms) | 33.5 ± 0.41 | 33.9 ± 0.22 | 34.6 ± 1.5 |
| P-D13 | proveMs (ms) | 317 ± 3.2 | 445 ± 4.8 | 441 ± 17 |
| P-D13 | verifyMs (ms) | 11.7 ± 0.12 | 11.9 ± 0.55 | 11.9 ± 0.68 |
| P-D13 | castGas (gas/ballot) | 307,504 ± 2,137 | 326,867 ± 9.5 | 326,947 ± 8.3 |
| P-D13 | calldataBytes (B/ballot) | 356 ± 0 | 356 ± 0 | 356 ± 0 |
| P-D13 | verifierGas (gas/proof) | 221,447 ± 0 | 221,447 ± 0 | 221,447 ± 0 |
| P-D13 | resultGasPerBallot (gas/ballot) | 0 ± 0 | 35,775 ± 2,488 | 64,228 ± 2,740 |
| P-D13 | resultMs (ms) | 30.7 ± 0.64 | 387 ± 7.9 | 430 ± 15 |
| P-D13 | proverPeakMiB (MiB) | 464 ± 17 | 488 ± 7.2 | 484 ± 17 |
| P-D13 | provingMemoryMiB (MiB) | 390 ± 17 | 414 ± 7.1 | 409 ± 18 |

## Paired contrasts (per-block differences; Holm within each contrast-by-outcome family)

| Contrast | Outcome | Cell | n | Mean difference [95% CI] | Mean ratio | Holm p |
|---|---|---|---|---|---|---|
| publisher-public | proofMs (ms) | P-D05 | 3 | 3.45 [-36.2, 43.1] | 1.02 | 0.74 |
| publisher-public | proofMs (ms) | P-D13 | 3 | 129 [109, 148] | 1.37 | 0.0025 |
| publisher-public | witnessMs (ms) | P-D05 | 3 | -0.147 [-2.28, 1.98] | 0.996 | 0.79 |
| publisher-public | witnessMs (ms) | P-D13 | 3 | 0.38 [-0.0945, 0.855] | 1.01 | 0.15 |
| publisher-public | proveMs (ms) | P-D05 | 3 | 3.6 [-34.2, 41.4] | 1.02 | 0.72 |
| publisher-public | proveMs (ms) | P-D13 | 3 | 128 [109, 148] | 1.41 | 0.0025 |
| publisher-public | castGas (gas/ballot) | P-D05 | 3 | 17,937 [14,886, 20,988] | 1.06 | 0.0031 |
| publisher-public | castGas (gas/ballot) | P-D13 | 3 | 19,363 [14,034, 24,691] | 1.06 | 0.0041 |
| publisher-public | provingMemoryMiB (MiB) | P-D05 | 3 | 13.5 [-7.88, 34.9] | 1.05 | 0.16 |
| publisher-public | provingMemoryMiB (MiB) | P-D13 | 3 | 23.8 [-6.82, 54.4] | 1.06 | 0.16 |
| reveal-public | proofMs (ms) | P-D05 | 3 | 1.85 [-44.3, 48] | 1.01 | 0.88 |
| reveal-public | proofMs (ms) | P-D13 | 3 | 126 [86.7, 164] | 1.36 | 0.01 |
| reveal-public | castGas (gas/ballot) | P-D05 | 3 | 18,009 [14,923, 21,095] | 1.06 | 0.0032 |
| reveal-public | castGas (gas/ballot) | P-D13 | 3 | 19,443 [14,152, 24,734] | 1.06 | 0.004 |
| reveal-public | resultGasPerBallot (gas/ballot) | P-D05 | 3 | 66,050 [62,132, 69,969] | — | <0.001 |
| reveal-public | resultGasPerBallot (gas/ballot) | P-D13 | 3 | 64,228 [57,422, 71,034] | — | <0.001 |
| reveal-publisher | proofMs (ms) | P-D05 | 3 | -1.61 [-8.07, 4.86] | 0.993 | 0.79 |
| reveal-publisher | proofMs (ms) | P-D13 | 3 | -3.02 [-59.1, 53.1] | 0.994 | 0.84 |
| reveal-publisher | castGas (gas/ballot) | P-D05 | 3 | 72 [35.3, 109] | 1 | 0.027 |
| reveal-publisher | castGas (gas/ballot) | P-D13 | 3 | 80.5 [36.4, 125] | 1 | 0.027 |
| reveal-publisher | resultGasPerBallot (gas/ballot) | P-D05 | 3 | 28,616 [28,268, 28,964] | 1.77 | <0.001 |
| reveal-publisher | resultGasPerBallot (gas/ballot) | P-D13 | 3 | 28,453 [27,826, 29,080] | 1.8 | <0.001 |
| reveal-publisher | resultMs (ms) | P-D05 | 3 | -39.8 [-374, 294] | 0.96 | 0.66 |
| reveal-publisher | resultMs (ms) | P-D13 | 3 | 43 [-2.65, 88.6] | 1.11 | 0.11 |

## Cost model against measurement

| Cell | Constraints (public → commitment) | Constraint ratio | Domain (public → commitment) | Measured proof-time ratio |
|---|---|---|---|---|
| P-D05 | 3570 → 4087 | 1.14 | 2^12 → 2^12 | 1.02 |
| P-D13 | 7762 → 8279 | 1.07 | 2^13 → 2^14 (threshold) | 1.37 |
