# Independent cross-check of the reported statistics

t quantiles used: df=5 -> 2.5705818, df=11 -> 2.2009852 (reference values 2.5705818 and 2.2009852)

## A. Harness analysis (summary.json): 144 contrast rows checked

Largest absolute discrepancy per quantity: ciHigh 9.09e-12, ciLow 1.46e-11, holmP 1.1e-13, mean 3.64e-12, meanRatio 1.42e-14, p 4e-14

## B. Run-median proof-time contrasts (paper_analysis.json): 36 rows checked

Largest absolute discrepancy: 0.00224 ms (interval ends differ only through the three-decimal t quantiles used by paper_analysis.py)

## C. Population integrity: 114 blocks, 342 runs, 39,168 ballots

Every block has all three workflows with identical vote sequences, every run cast all planned ballots, and every result phase reproduced the tally of the cast votes.

## Result

No mismatches: every mean, interval, mean ratio, p-value and Holm-adjusted p-value agrees.
