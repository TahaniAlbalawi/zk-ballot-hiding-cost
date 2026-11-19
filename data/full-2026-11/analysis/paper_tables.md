# Paper analyses

## Population

| Cell | Blocks | Runs | Ballots |
|---|---:|---:|---:|
| CAND-C02 | 6 | 18 | 576 |
| CAND-C08 | 6 | 18 | 576 |
| DEPTH-D05 | 12 | 36 | 1,152 |
| DEPTH-D08 | 12 | 36 | 1,152 |
| DEPTH-D10 | 12 | 36 | 1,152 |
| DEPTH-D12 | 12 | 36 | 1,152 |
| DEPTH-D13 | 12 | 36 | 1,152 |
| DEPTH-D16 | 12 | 36 | 1,152 |
| DEPTH-D20 | 12 | 36 | 1,152 |
| SCALE-B0128 | 6 | 18 | 2,304 |
| SCALE-B0512 | 6 | 18 | 9,216 |
| SCALE-B1024 | 6 | 18 | 18,432 |

## Cast gas decomposition (gas per ballot)

| Cell | Public steady | Publisher steady | Reveal steady | Pbr−Pub steady | First-ballot premium (Pub/Pbr/Rev) | New-candidate premium (Pub) | Max |model error| of mean diff |
|---|---:|---:|---:|---:|---|---:|---:|
| CAND-C02 | 298,945.9 | 322,591.9 | 322,670.5 | 23,646.1 | 34,207/34,201/34,207 | 17,097 | 15.8 |
| CAND-C08 | 298,948.4 | 322,595.0 | 322,669.5 | 23,646.6 | 34,195/34,196/34,210 | 17,104 | 21.1 |
| DEPTH-D05 | 298,949.2 | 322,591.9 | 322,670.3 | 23,642.6 | 34,201/34,199/34,203 | 17,101 | 16.2 |
| DEPTH-D08 | 298,948.9 | 322,593.4 | 322,671.8 | 23,644.5 | 34,207/34,196/34,205 | 17,103 | 13.0 |
| DEPTH-D10 | 298,948.6 | 322,591.6 | 322,671.5 | 23,643.0 | 34,201/34,204/34,196 | 17,097 | 14.5 |
| DEPTH-D12 | 298,949.2 | 322,593.7 | 322,671.6 | 23,644.5 | 34,203/34,201/34,206 | 17,100 | 18.6 |
| DEPTH-D13 | 298,948.8 | 322,591.4 | 322,669.7 | 23,642.6 | 34,200/34,204/34,198 | 17,099 | 16.3 |
| DEPTH-D16 | 298,949.7 | 322,591.4 | 322,669.2 | 23,641.7 | 34,198/34,201/34,202 | 17,100 | 15.7 |
| DEPTH-D20 | 298,949.0 | 322,591.8 | 322,670.0 | 23,642.8 | 34,197/34,193/34,198 | 17,097 | 14.7 |
| SCALE-B0128 | 298,947.7 | 322,593.1 | 322,670.3 | 23,645.3 | 34,203/34,204/34,203 | 17,102 | 13.6 |
| SCALE-B0512 | 298,948.8 | 322,592.0 | 322,670.1 | 23,643.3 | 34,204/34,209/34,207 | 17,104 | 13.2 |
| SCALE-B1024 | 298,948.4 | 322,591.9 | 322,669.8 | 23,643.5 | 34,197/34,193/34,205 | 17,101 | 12.8 |

## Proof time: run means (primary) and run medians (sensitivity), ms

| Cell | Stat | Public | Publisher | Reveal | Pbr−Pub [95% CI] | Rev−Pub [95% CI] | Rev−Pbr [95% CI] | Stalls (Pub/Pbr/Rev) |
|---|---|---:|---:|---:|---|---|---|---|
| CAND-C02 | mean | 297.8 | 305.3 | 305.3 | 7.4 [-1.8, 16.7] ×1.026 | 7.5 [1.6, 13.4] ×1.025 | 0.0 [-4.0, 4.1] ×1.000 | 0/0/0 |
| CAND-C02 | median | 292.8 | 303.9 | 302.9 | 11.1 [10.1, 12.0] ×1.038 | 10.1 [8.9, 11.3] ×1.035 | -1.0 [-1.9, 0.0] ×0.997 | 0/0/0 |
| CAND-C08 | mean | 295.0 | 304.5 | 307.6 | 9.5 [5.9, 13.0] ×1.032 | 12.5 [6.8, 18.3] ×1.043 | 3.1 [-0.8, 7.0] ×1.010 | 0/0/0 |
| CAND-C08 | median | 292.1 | 303.3 | 304.4 | 11.2 [10.2, 12.2] ×1.038 | 12.3 [10.5, 14.2] ×1.042 | 1.1 [-0.8, 3.0] ×1.004 | 0/0/0 |
| DEPTH-D05 | mean | 204.2 | 247.6 | 218.6 | 43.4 [-8.3, 95.0] ×1.217 | 14.3 [8.9, 19.7] ×1.071 | -29.0 [-80.7, 22.6] ×0.931 | 0/3/0 |
| DEPTH-D05 | median | 200.9 | 220.8 | 216.6 | 19.9 [15.7, 24.0] ×1.099 | 15.6 [12.8, 18.4] ×1.078 | -4.3 [-8.0, -0.5] ×0.981 | 0/3/0 |
| DEPTH-D08 | mean | 272.7 | 281.8 | 281.4 | 9.1 [3.6, 14.6] ×1.034 | 8.7 [3.6, 13.9] ×1.033 | -0.3 [-3.7, 3.0] ×0.999 | 1/0/0 |
| DEPTH-D08 | median | 268.2 | 279.2 | 279.1 | 11.0 [10.3, 11.8] ×1.041 | 10.9 [10.1, 11.8] ×1.041 | -0.1 [-0.7, 0.6] ×1.000 | 1/0/0 |
| DEPTH-D10 | mean | 312.3 | 321.5 | 322.7 | 9.2 [-0.4, 18.8] ×1.030 | 10.4 [-10.9, 31.7] ×1.036 | 1.2 [-22.6, 25.0] ×1.008 | 1/0/0 |
| DEPTH-D10 | median | 302.8 | 313.0 | 317.9 | 10.1 [1.5, 18.7] ×1.034 | 15.0 [-2.7, 32.7] ×1.051 | 4.9 [-13.6, 23.4] ×1.017 | 1/0/0 |
| DEPTH-D12 | mean | 316.3 | 329.2 | 328.0 | 12.9 [9.9, 15.9] ×1.041 | 11.7 [9.9, 13.5] ×1.037 | -1.2 [-4.2, 1.8] ×0.996 | 0/0/0 |
| DEPTH-D12 | median | 315.4 | 327.1 | 326.8 | 11.6 [10.4, 12.9] ×1.037 | 11.3 [10.3, 12.4] ×1.036 | -0.3 [-1.3, 0.8] ×0.999 | 0/0/0 |
| DEPTH-D13 | mean | 328.3 | 438.1 | 437.6 | 109.8 [107.6, 112.0] ×1.335 | 109.4 [106.3, 112.4] ×1.333 | -0.5 [-3.1, 2.2] ×0.999 | 0/0/0 |
| DEPTH-D13 | median | 326.6 | 434.7 | 434.8 | 108.2 [107.2, 109.2] ×1.331 | 108.2 [107.3, 109.2] ×1.331 | 0.1 [-1.0, 1.2] ×1.000 | 0/0/0 |
| DEPTH-D16 | mean | 461.2 | 473.0 | 471.2 | 11.8 [6.7, 17.0] ×1.026 | 10.0 [4.6, 15.5] ×1.022 | -1.8 [-8.0, 4.3] ×0.996 | 0/0/0 |
| DEPTH-D16 | median | 456.8 | 467.4 | 466.8 | 10.5 [9.8, 11.3] ×1.023 | 10.0 [9.0, 10.9] ×1.022 | -0.6 [-1.4, 0.3] ×0.999 | 0/0/0 |
| DEPTH-D20 | mean | 502.6 | 511.8 | 511.0 | 9.1 [5.3, 13.0] ×1.018 | 8.3 [3.8, 12.9] ×1.017 | -0.8 [-3.8, 2.1] ×0.998 | 0/0/0 |
| DEPTH-D20 | median | 498.0 | 508.5 | 508.7 | 10.5 [9.7, 11.3] ×1.021 | 10.8 [8.8, 12.7] ×1.022 | 0.2 [-1.7, 2.2] ×1.000 | 0/0/0 |
| SCALE-B0128 | mean | 463.6 | 471.1 | 470.6 | 7.5 [-1.0, 16.1] ×1.017 | 7.0 [-5.8, 19.9] ×1.016 | -0.5 [-5.3, 4.3] ×0.999 | 0/0/0 |
| SCALE-B0128 | median | 457.4 | 467.6 | 466.3 | 10.2 [9.6, 10.9] ×1.022 | 8.9 [6.9, 10.9] ×1.020 | -1.3 [-3.4, 0.8] ×0.997 | 0/0/0 |
| SCALE-B0512 | mean | 482.3 | 484.4 | 486.0 | 2.1 [-12.4, 16.5] ×1.006 | 3.7 [-14.0, 21.3] ×1.008 | 1.6 [-21.3, 24.5] ×1.003 | 1/0/0 |
| SCALE-B0512 | median | 469.2 | 474.0 | 474.8 | 4.7 [-6.2, 15.7] ×1.011 | 5.6 [-3.8, 15.0] ×1.012 | 0.8 [-12.9, 14.6] ×1.002 | 1/0/0 |
| SCALE-B1024 | mean | 459.0 | 468.6 | 470.2 | 9.6 [7.5, 11.6] ×1.021 | 11.2 [9.1, 13.3] ×1.024 | 1.6 [-0.6, 3.8] ×1.003 | 0/0/0 |
| SCALE-B1024 | median | 455.2 | 465.3 | 465.4 | 10.1 [9.4, 10.8] ×1.022 | 10.2 [9.5, 10.9] ×1.022 | 0.1 [-0.3, 0.4] ×1.000 | 0/0/0 |

## Proving-time model T = alpha*m + kappa(N), fitted on public DEPTH runs

alpha = 0.01948 ms per wire; kappa(N) = 4096: 134.5 ms, 8192: 178.9 ms, 16384: 279.3 ms

| Commitment cell | Predicted (ms) | Measured (ms) | Relative error |
|---|---:|---:|---:|
| DEPTH-D05 | 214.3 | 233.1 | -8.0% |
| DEPTH-D08 | 289.4 | 281.6 | +2.7% |
| DEPTH-D10 | 309.8 | 322.1 | -3.8% |
| DEPTH-D12 | 330.3 | 328.6 | +0.5% |
| DEPTH-D13 | 440.9 | 437.9 | +0.7% |
| DEPTH-D16 | 471.6 | 472.1 | -0.1% |
| DEPTH-D20 | 512.5 | 511.4 | +0.2% |

### Sensitivity: the same model on run medians

alpha = 0.02066 ms per wire; kappa(N) = 4096: 127.0 ms, 8192: 167.0 ms, 16384: 262.5 ms

| Commitment cell | Predicted (ms) | Measured (ms) | Relative error |
|---|---:|---:|---:|
| DEPTH-D05 | 211.6 | 218.7 | -3.2% |
| DEPTH-D08 | 284.1 | 279.1 | +1.8% |
| DEPTH-D10 | 305.8 | 315.4 | -3.0% |
| DEPTH-D12 | 327.5 | 326.9 | +0.2% |
| DEPTH-D13 | 433.9 | 434.8 | -0.2% |
| DEPTH-D16 | 466.4 | 467.1 | -0.1% |
| DEPTH-D20 | 509.8 | 508.6 | +0.2% |

### Checks of the time model

Leave-one-depth-out refits on the public cells:

| Held-out public cell | Predicted (ms) | Measured (ms) | Relative error |
|---|---:|---:|---:|
| DEPTH-D05 | — | — | not identifiable (only cell in its domain) |
| DEPTH-D08 | 288.4 | 272.7 | +5.8% |
| DEPTH-D10 | 294.9 | 312.3 | -5.6% |
| DEPTH-D12 | 322.0 | 316.3 | +1.8% |
| DEPTH-D13 | 332.3 | 328.3 | +1.2% |
| DEPTH-D16 | 462.0 | 461.2 | +0.2% |
| DEPTH-D20 | 501.8 | 502.6 | -0.2% |

Commitment circuit at D = 12 predicted without the public cell D = 13: 332.2 ms against 328.6 ms measured (+1.1%)

Threshold (DEPTH-D13): measured pooled ratio 1.3339 [1.3260, 1.3419]; predicted 1.3344 (block bootstrap 95% [1.3220, 1.3475], 2000 replicates); proving step alone, Publisher over Public: 1.371 [1.363, 1.380] (295.2 -> 404.7 ms)

## Proving memory against key size (DEPTH runs)

slope = 42.89 MiB per MiB of key; intercept = 233.2 MiB; Pearson r = 0.883; n = 252 runs

## Memory controls (MiB)

Reveal − Publisher (same circuit and key): positive in 11 of 12 cells, range -0.4 to +10.4, mean of cells +5.1; proving-process peak RSS 328–501; baseline peak RSS 72–76

| Cell | Rev−Pbr [95% CI] | Peak RSS Pub/Pbr/Rev |
|---|---|---|
| CAND-C02 | +6.1 [+1.3, +10.8] | 430/442/447 |
| CAND-C08 | +3.3 [-5.1, +11.6] | 433/442/446 |
| DEPTH-D05 | -0.4 [-5.1, +4.3] | 328/341/340 |
| DEPTH-D08 | +1.4 [-0.1, +3.0] | 401/419/421 |
| DEPTH-D10 | +5.4 [-4.9, +15.7] | 432/437/442 |
| DEPTH-D12 | +2.3 [+0.3, +4.3] | 460/475/477 |
| DEPTH-D13 | +8.7 [+3.4, +14.0] | 470/489/497 |
| DEPTH-D16 | +3.7 [-2.2, +9.6] | 489/497/501 |
| DEPTH-D20 | +6.1 [+1.2, +11.0] | 493/492/498 |
| SCALE-B0128 | +7.3 [+2.8, +11.8] | 494/492/500 |
| SCALE-B0512 | +10.4 [-11.3, +32.1] | 491/486/498 |
| SCALE-B1024 | +6.5 [-5.2, +18.2] | 491/495/501 |

## Result phase

| Cell | Workflow | B | C | Gas (mean) | Gas per ballot | Time ms (mean ± SD) |
|---|---|---:|---:|---:|---:|---|
| CAND-C02 | Public | 32 | 2 | 0 | 0 | 36.7 ± 0.6 |
| CAND-C02 | Publisher | 32 | 2 | 258,877 | 8,090 | 769.3 ± 10.3 |
| CAND-C02 | Reveal | 32 | 2 | 1,357,467 | 42,421 | 1,221.4 ± 33.1 |
| CAND-C08 | Public | 32 | 8 | 0 | 0 | 37.2 ± 1.5 |
| CAND-C08 | Publisher | 32 | 8 | 397,267 | 12,415 | 764.1 ± 17.4 |
| CAND-C08 | Reveal | 32 | 8 | 1,502,077 | 46,940 | 1,250.3 ± 23.2 |
| DEPTH-D05 | Public | 32 | 4 | 0 | 0 | 35.3 ± 0.9 |
| DEPTH-D05 | Publisher | 32 | 4 | 306,118 | 9,566 | 715.9 ± 66.7 |
| DEPTH-D05 | Reveal | 32 | 4 | 1,406,919 | 43,966 | 1,202.5 ± 245.8 |
| DEPTH-D08 | Public | 32 | 4 | 0 | 0 | 34.7 ± 0.5 |
| DEPTH-D08 | Publisher | 32 | 4 | 306,117 | 9,566 | 700.5 ± 13.6 |
| DEPTH-D08 | Reveal | 32 | 4 | 1,406,904 | 43,966 | 1,170.0 ± 32.9 |
| DEPTH-D10 | Public | 32 | 4 | 0 | 0 | 35.0 ± 1.5 |
| DEPTH-D10 | Publisher | 32 | 4 | 306,119 | 9,566 | 705.2 ± 18.7 |
| DEPTH-D10 | Reveal | 32 | 4 | 1,406,904 | 43,966 | 1,174.7 ± 41.1 |
| DEPTH-D12 | Public | 32 | 4 | 0 | 0 | 35.3 ± 2.0 |
| DEPTH-D12 | Publisher | 32 | 4 | 306,114 | 9,566 | 721.2 ± 34.4 |
| DEPTH-D12 | Reveal | 32 | 4 | 1,406,918 | 43,966 | 1,188.0 ± 60.9 |
| DEPTH-D13 | Public | 32 | 4 | 0 | 0 | 36.2 ± 1.1 |
| DEPTH-D13 | Publisher | 32 | 4 | 306,117 | 9,566 | 762.8 ± 11.9 |
| DEPTH-D13 | Reveal | 32 | 4 | 1,406,921 | 43,966 | 1,244.7 ± 30.1 |
| DEPTH-D16 | Public | 32 | 4 | 0 | 0 | 35.1 ± 1.6 |
| DEPTH-D16 | Publisher | 32 | 4 | 306,116 | 9,566 | 732.9 ± 29.8 |
| DEPTH-D16 | Reveal | 32 | 4 | 1,406,918 | 43,966 | 1,218.2 ± 46.8 |
| DEPTH-D20 | Public | 32 | 4 | 0 | 0 | 35.8 ± 1.4 |
| DEPTH-D20 | Publisher | 32 | 4 | 306,121 | 9,566 | 756.6 ± 27.8 |
| DEPTH-D20 | Reveal | 32 | 4 | 1,406,929 | 43,967 | 1,203.7 ± 44.2 |
| SCALE-B0128 | Public | 128 | 4 | 0 | 0 | 67.5 ± 5.1 |
| SCALE-B0128 | Publisher | 128 | 4 | 306,128 | 2,392 | 2,216.4 ± 16.7 |
| SCALE-B0128 | Reveal | 128 | 4 | 5,101,422 | 39,855 | 4,389.0 ± 116.1 |
| SCALE-B0512 | Public | 512 | 4 | 0 | 0 | 662.0 ± 1,204.3 |
| SCALE-B0512 | Publisher | 512 | 4 | 306,132 | 598 | 7,897.3 ± 362.6 |
| SCALE-B0512 | Reveal | 512 | 4 | 19,899,658 | 38,867 | 16,670.0 ± 748.5 |
| SCALE-B1024 | Public | 1024 | 4 | 0 | 0 | 282.4 ± 4.5 |
| SCALE-B1024 | Publisher | 1024 | 4 | 306,150 | 299 | 15,768.0 ± 168.7 |
| SCALE-B1024 | Reveal | 1024 | 4 | 39,644,202 | 38,715 | 34,882.3 ± 822.4 |

Reveal result gas (batches + finalization, C = 4) regressed on B: 38,542.3 gas per ballot; intercept 172,982 (finalization alone 72,820); largest relative residual 0.099%; publisher result gas (C = 4): 306,121; break-even election size: 3.5 ballots

Reveal batches (b = 32): first batch 1,334,095 gas; later batches median 1,231,876 (range 1,231,396–1,249,060); in-batch gas per ballot (upper bound) 37,839.9; EIP-7825 bound on ballots per batch: 440.1

Publisher result gas by C (runs with every candidate voted): C=2: 258,877, C=4: 306,121, C=8: 400,590; fit 211,646 + 23,618·C. Reveal finalization by C: C=2: 67,241, C=4: 72,820, C=8: 83,977

## Fixed costs, verification and calldata

Deployment gas: registry 729,587; verifierPublic 469,611–469,851; verifierCommitment 469,635–469,875; ballotBox 2,258,435; setVerifierPrivate 45,640; poseidonHasher 2,157,126; setCommitmentHasher 45,546

Election creation (without first-election premium): Public 97,929, Publisher 122,159, Reveal 98,144

Verifier execution gas values: 221,447

Off-chain verification, median per cell (ms): CAND-C02 11.33, CAND-C08 11.33, DEPTH-D05 10.15, DEPTH-D08 11.28, DEPTH-D10 11.34, DEPTH-D12 11.31, DEPTH-D13 11.11, DEPTH-D16 10.98, DEPTH-D20 10.99, SCALE-B0128 11.08, SCALE-B0512 11.32, SCALE-B1024 11.58

Cast calldata: Public [356] bytes, 4929.6 gas, Publisher [356] bytes, 5303.1 gas, Reveal [356] bytes, 5303.1 gas

## Host disturbances

Stalled ballots (> 3x run median): 6 of 39,168; slowest ballot 5,814 ms (DEPTH-D05 block 8 Publisher)

- DEPTH-D05 block 8 Publisher: 5,814 ms
- DEPTH-D05 block 8 Publisher: 948 ms
- DEPTH-D05 block 8 Publisher: 1,271 ms
- DEPTH-D08 block 2 Public: 821 ms
- DEPTH-D10 block 3 Public: 876 ms
- SCALE-B0512 block 2 Public: 1,553 ms

Effect of the stalls on their run means (ms):

- DEPTH-D05 block 8 Publisher: stalls 5,814, 1,271, 948; run mean 496.2, without stalls 270.6, median 225.7; the longest stall alone adds 174.6
- DEPTH-D10 block 3 Public: stalls 876; run mean 310.3, without stalls 292.0, median 290.5; the longest stall alone adds 18.3
- DEPTH-D08 block 2 Public: stalls 821; run mean 291.3, without stalls 274.2, median 267.6; the longest stall alone adds 17.3
- SCALE-B0512 block 2 Public: stalls 1,553; run mean 532.4, without stalls 530.4, median 499.8; the longest stall alone adds 2.1

Public run means in execution order (ms), first and last block of each cell: DEPTH-D05 209.3 → 192.7; DEPTH-D08 269.7 → 271.8; DEPTH-D10 290.6 → 305.5; DEPTH-D12 316.4 → 315.4; DEPTH-D13 329.6 → 327.3; DEPTH-D16 455.6 → 459.8; DEPTH-D20 496.0 → 499.2; CAND-C02 294.3 → 295.1; CAND-C08 297.4 → 295.1; SCALE-B0128 458.1 → 485.6; SCALE-B0512 498.0 → 455.8; SCALE-B1024 456.9 → 462.5


## Per-block run medians of proof time: paired differences (ms)

| Cell | Block | Order | Pbr−Pub | Rev−Pub | Rev−Pbr |
|---|---:|---|---:|---:|---:|
| CAND-C02 | 1 | RPB | 11.1 | 9.3 | -1.8 |
| CAND-C02 | 2 | RBP | 11.7 | 11.6 | -0.1 |
| CAND-C02 | 3 | PBR | 11.0 | 9.5 | -1.5 |
| CAND-C02 | 4 | PRB | 12.3 | 10.6 | -1.7 |
| CAND-C02 | 5 | BPR | 9.8 | 8.7 | -1.1 |
| CAND-C02 | 6 | BRP | 10.5 | 10.9 | 0.4 |
| CAND-C08 | 1 | PBR | 10.5 | 11.2 | 0.7 |
| CAND-C08 | 2 | PRB | 11.5 | 13.3 | 1.7 |
| CAND-C08 | 3 | BPR | 11.9 | 13.7 | 1.8 |
| CAND-C08 | 4 | BRP | 11.6 | 14.4 | 2.8 |
| CAND-C08 | 5 | RPB | 12.1 | 9.7 | -2.4 |
| CAND-C08 | 6 | RBP | 9.7 | 11.6 | 1.9 |
| DEPTH-D05 | 1 | BPR | 27.0 | 20.8 | -6.1 |
| DEPTH-D05 | 2 | BRP | 20.2 | 23.0 | 2.8 |
| DEPTH-D05 | 3 | RPB | 22.0 | 18.5 | -3.5 |
| DEPTH-D05 | 4 | RBP | 11.2 | 9.6 | -1.5 |
| DEPTH-D05 | 5 | PBR | 28.3 | 13.7 | -14.6 |
| DEPTH-D05 | 6 | PRB | 19.2 | 19.5 | 0.3 |
| DEPTH-D05 | 7 | BPR | 15.7 | 9.5 | -6.1 |
| DEPTH-D05 | 8 | BRP | 33.0 | 16.8 | -16.3 |
| DEPTH-D05 | 9 | RPB | 15.7 | 16.5 | 0.8 |
| DEPTH-D05 | 10 | RBP | 16.0 | 14.3 | -1.8 |
| DEPTH-D05 | 11 | PBR | 15.0 | 10.5 | -4.5 |
| DEPTH-D05 | 12 | PRB | 15.4 | 15.0 | -0.4 |
| DEPTH-D08 | 1 | PBR | 12.8 | 12.0 | -0.8 |
| DEPTH-D08 | 2 | PRB | 11.0 | 11.2 | 0.2 |
| DEPTH-D08 | 3 | BPR | 9.8 | 10.4 | 0.5 |
| DEPTH-D08 | 4 | BRP | 11.2 | 9.8 | -1.4 |
| DEPTH-D08 | 5 | RPB | 11.1 | 11.7 | 0.6 |
| DEPTH-D08 | 6 | RBP | 12.0 | 11.8 | -0.1 |
| DEPTH-D08 | 7 | PBR | 12.4 | 10.8 | -1.6 |
| DEPTH-D08 | 8 | PRB | 10.4 | 11.9 | 1.5 |
| DEPTH-D08 | 9 | BPR | 11.3 | 11.1 | -0.2 |
| DEPTH-D08 | 10 | BRP | 11.1 | 10.7 | -0.4 |
| DEPTH-D08 | 11 | RPB | 8.4 | 7.4 | -1.0 |
| DEPTH-D08 | 12 | RBP | 10.8 | 12.4 | 1.6 |
| DEPTH-D10 | 1 | RBP | 12.6 | 12.2 | -0.4 |
| DEPTH-D10 | 2 | PBR | 10.0 | 11.6 | 1.6 |
| DEPTH-D10 | 3 | PRB | 11.0 | 11.1 | 0.1 |
| DEPTH-D10 | 4 | BPR | 12.3 | 11.9 | -0.4 |
| DEPTH-D10 | 5 | BRP | 7.6 | 10.3 | 2.6 |
| DEPTH-D10 | 6 | RPB | 43.8 | -6.0 | -49.8 |
| DEPTH-D10 | 7 | RBP | 15.4 | 98.7 | 83.3 |
| DEPTH-D10 | 8 | PBR | -10.9 | -7.3 | 3.6 |
| DEPTH-D10 | 9 | PRB | -9.6 | -7.0 | 2.6 |
| DEPTH-D10 | 10 | BPR | 11.2 | 12.4 | 1.2 |
| DEPTH-D10 | 11 | BRP | 10.4 | 13.9 | 3.6 |
| DEPTH-D10 | 12 | RPB | 7.6 | 18.5 | 10.9 |
| DEPTH-D12 | 1 | PBR | 9.4 | 11.6 | 2.1 |
| DEPTH-D12 | 2 | PRB | 12.5 | 11.7 | -0.8 |
| DEPTH-D12 | 3 | BPR | 10.5 | 12.2 | 1.7 |
| DEPTH-D12 | 4 | BRP | 9.1 | 11.2 | 2.1 |
| DEPTH-D12 | 5 | RPB | 9.4 | 10.5 | 1.1 |
| DEPTH-D12 | 6 | RBP | 9.8 | 7.6 | -2.2 |
| DEPTH-D12 | 7 | PBR | 13.0 | 12.4 | -0.7 |
| DEPTH-D12 | 8 | PRB | 12.0 | 10.1 | -1.9 |
| DEPTH-D12 | 9 | BPR | 12.3 | 10.6 | -1.7 |
| DEPTH-D12 | 10 | BRP | 15.7 | 14.1 | -1.7 |
| DEPTH-D12 | 11 | RPB | 12.7 | 11.3 | -1.4 |
| DEPTH-D12 | 12 | RBP | 13.0 | 12.9 | -0.1 |
| DEPTH-D13 | 1 | RPB | 108.0 | 106.1 | -1.9 |
| DEPTH-D13 | 2 | RBP | 109.0 | 109.2 | 0.2 |
| DEPTH-D13 | 3 | PBR | 105.6 | 107.9 | 2.3 |
| DEPTH-D13 | 4 | PRB | 107.7 | 108.0 | 0.3 |
| DEPTH-D13 | 5 | BPR | 106.6 | 107.0 | 0.5 |
| DEPTH-D13 | 6 | BRP | 109.2 | 107.7 | -1.5 |
| DEPTH-D13 | 7 | RPB | 107.4 | 107.3 | -0.1 |
| DEPTH-D13 | 8 | RBP | 111.1 | 110.9 | -0.3 |
| DEPTH-D13 | 9 | PBR | 107.8 | 107.4 | -0.3 |
| DEPTH-D13 | 10 | PRB | 107.7 | 111.1 | 3.4 |
| DEPTH-D13 | 11 | BPR | 110.5 | 107.6 | -2.9 |
| DEPTH-D13 | 12 | BRP | 107.3 | 108.7 | 1.4 |
| DEPTH-D16 | 1 | RPB | 12.2 | 11.3 | -0.9 |
| DEPTH-D16 | 2 | RBP | 10.5 | 9.6 | -0.9 |
| DEPTH-D16 | 3 | PBR | 9.9 | 9.5 | -0.4 |
| DEPTH-D16 | 4 | PRB | 11.0 | 9.3 | -1.7 |
| DEPTH-D16 | 5 | BPR | 8.9 | 9.2 | 0.3 |
| DEPTH-D16 | 6 | BRP | 8.3 | 7.9 | -0.4 |
| DEPTH-D16 | 7 | RPB | 10.3 | 10.3 | -0.0 |
| DEPTH-D16 | 8 | RBP | 10.6 | 8.7 | -1.9 |
| DEPTH-D16 | 9 | PBR | 12.2 | 12.1 | -0.1 |
| DEPTH-D16 | 10 | PRB | 10.4 | 13.0 | 2.6 |
| DEPTH-D16 | 11 | BPR | 11.1 | 8.6 | -2.5 |
| DEPTH-D16 | 12 | BRP | 11.2 | 10.3 | -0.9 |
| DEPTH-D20 | 1 | PRB | 10.9 | 14.3 | 3.5 |
| DEPTH-D20 | 2 | BPR | 10.9 | 11.7 | 0.9 |
| DEPTH-D20 | 3 | BRP | 10.4 | 10.9 | 0.5 |
| DEPTH-D20 | 4 | RPB | 8.2 | 7.6 | -0.7 |
| DEPTH-D20 | 5 | RBP | 10.5 | 9.4 | -1.1 |
| DEPTH-D20 | 6 | PBR | 8.7 | 8.5 | -0.2 |
| DEPTH-D20 | 7 | PRB | 12.7 | 11.2 | -1.5 |
| DEPTH-D20 | 8 | BPR | 10.2 | 7.4 | -2.8 |
| DEPTH-D20 | 9 | BRP | 10.5 | 10.2 | -0.4 |
| DEPTH-D20 | 10 | RPB | 12.7 | 8.1 | -4.6 |
| DEPTH-D20 | 11 | RBP | 10.2 | 17.9 | 7.6 |
| DEPTH-D20 | 12 | PBR | 10.2 | 11.8 | 1.7 |
| SCALE-B0128 | 1 | PRB | 9.6 | 9.8 | 0.1 |
| SCALE-B0128 | 2 | BPR | 10.3 | 8.4 | -1.9 |
| SCALE-B0128 | 3 | BRP | 10.1 | 10.5 | 0.4 |
| SCALE-B0128 | 4 | RPB | 11.4 | 9.4 | -2.0 |
| SCALE-B0128 | 5 | RBP | 9.8 | 10.0 | 0.2 |
| SCALE-B0128 | 6 | PBR | 10.1 | 5.4 | -4.7 |
| SCALE-B0512 | 1 | RBP | 14.1 | -3.2 | -17.3 |
| SCALE-B0512 | 2 | PBR | -9.6 | 14.1 | 23.7 |
| SCALE-B0512 | 3 | PRB | -7.5 | -8.1 | -0.6 |
| SCALE-B0512 | 4 | BPR | 11.1 | 9.4 | -1.7 |
| SCALE-B0512 | 5 | BRP | 10.6 | 10.7 | 0.1 |
| SCALE-B0512 | 6 | RPB | 9.7 | 10.5 | 0.8 |
| SCALE-B1024 | 1 | BPR | 11.0 | 10.5 | -0.5 |
| SCALE-B1024 | 2 | BRP | 9.2 | 9.0 | -0.2 |
| SCALE-B1024 | 3 | RPB | 10.3 | 10.7 | 0.4 |
| SCALE-B1024 | 4 | RBP | 10.5 | 10.8 | 0.3 |
| SCALE-B1024 | 5 | PBR | 10.0 | 10.4 | 0.3 |
| SCALE-B1024 | 6 | PRB | 9.5 | 9.7 | 0.2 |
