/**
 * Analysis of a v0.3 experiment output directory (runs.jsonl, artifacts.json).
 *
 * Election-level outcomes are computed per (cell, block, workflow) record; the
 * block is the unit of replication.  Reported:
 *   - absolute means with SD and 95% t-intervals per cell and workflow;
 *   - paired contrasts by block (difference, 95% CI, Holm-adjusted p within each
 *     outcome-by-contrast family across cells, and the mean per-block ratio);
 *   - the cost model next to the measurements (constraint ratio and Groth16
 *     domain size against the measured proving-time ratio).
 * The two commitment workflows cast identically, so their cast-time contrast is
 * an internal control that should be indistinguishable from zero.
 *
 * Usage: tsx evaluation/v3/analyze.ts <output-dir>
 */
import fs from "node:fs";
import path from "node:path";

type Workflow = "PUBLIC_DISCLOSURE" | "COMMITMENT_BALLOT_HIDING" | "COMMITMENT_ONCHAIN_REVEAL";
const SHORT: Record<Workflow, string> = {
    PUBLIC_DISCLOSURE: "public",
    COMMITMENT_BALLOT_HIDING: "publisher",
    COMMITMENT_ONCHAIN_REVEAL: "reveal",
};

// ---- statistics -------------------------------------------------------------

function logGamma(x: number): number {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x;
    const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
    let series = 1.000000000190015;
    for (const coefficient of c) series += coefficient / ++y;
    return -tmp + Math.log((2.5066282746310005 * series) / x);
}

/** Continued fraction for the regularized incomplete beta function. */
function betaContinuedFraction(x: number, a: number, b: number): number {
    const tiny = 1e-300;
    let c = 1;
    let d = 1 - ((a + b) * x) / (a + 1);
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 300; m++) {
        const m2 = 2 * m;
        let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
        d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
        c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
        d = 1 / d; h *= d * c;
        aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
        d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
        c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
        d = 1 / d;
        const delta = d * c;
        h *= delta;
        if (Math.abs(delta - 1) < 1e-12) break;
    }
    return h;
}

function regularizedBeta(x: number, a: number, b: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2)
        ? (front * betaContinuedFraction(x, a, b)) / a
        : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Two-sided p-value of Student's t with df degrees of freedom. */
function tPValue(t: number, df: number): number {
    return regularizedBeta(df / (df + t * t), df / 2, 0.5);
}

/** Two-sided critical value t* with P(|T| > t*) = alpha. */
function tCritical(df: number, alpha = 0.05): number {
    let low = 0;
    let high = 1000;
    for (let i = 0; i < 200; i++) {
        const mid = (low + high) / 2;
        if (tPValue(mid, df) > alpha) low = mid; else high = mid;
    }
    return (low + high) / 2;
}

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
function sd(values: number[]): number {
    if (values.length < 2) return NaN;
    const m = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

function describe(values: number[]) {
    const n = values.length;
    const m = mean(values);
    const s = sd(values);
    const half = n > 1 ? tCritical(n - 1) * s / Math.sqrt(n) : NaN;
    return { n, mean: m, sd: s, ciLow: m - half, ciHigh: m + half };
}

function pairedTest(differences: number[]) {
    const summary = describe(differences);
    const t = summary.mean / (summary.sd / Math.sqrt(summary.n));
    const p = summary.sd === 0 ? (summary.mean === 0 ? 1 : 0) : tPValue(Math.abs(t), summary.n - 1);
    return { ...summary, t, p };
}

function holm(pValues: number[]): number[] {
    const order = pValues.map((p, index) => ({ p, index })).sort((left, right) => left.p - right.p);
    const adjusted = new Array<number>(pValues.length);
    let running = 0;
    order.forEach(({ p, index }, rank) => {
        running = Math.max(running, Math.min(1, (pValues.length - rank) * p));
        adjusted[index] = running;
    });
    return adjusted;
}

// ---- outcomes ---------------------------------------------------------------

interface Run {
    cellId: string;
    family: string;
    configuration: string;
    depth: number;
    candidates: number;
    electorate: number;
    plannedBallots: number;
    block: number;
    workflow: Workflow;
    verifierExecutionGas: number;
    ballots: Array<{ witnessMs: number; proveMs: number; verifyMs: number; castGas: number; calldataBytes: number; txMs: number }>;
    memory: Array<{ proveBytes: number; baselineBytes: number; deltaBytes: number }>;
    result: Record<string, any>;
}

const OUTCOMES: Record<string, { unit: string; value: (run: Run) => number }> = {
    proofMs: { unit: "ms", value: (run) => mean(run.ballots.map((b) => b.witnessMs + b.proveMs)) },
    witnessMs: { unit: "ms", value: (run) => mean(run.ballots.map((b) => b.witnessMs)) },
    proveMs: { unit: "ms", value: (run) => mean(run.ballots.map((b) => b.proveMs)) },
    verifyMs: { unit: "ms", value: (run) => mean(run.ballots.map((b) => b.verifyMs)) },
    castGas: { unit: "gas/ballot", value: (run) => mean(run.ballots.map((b) => b.castGas)) },
    calldataBytes: { unit: "B/ballot", value: (run) => mean(run.ballots.map((b) => b.calldataBytes)) },
    verifierGas: { unit: "gas/proof", value: (run) => run.verifierExecutionGas },
    resultGasPerBallot: { unit: "gas/ballot", value: (run) => run.result.resultGas / run.plannedBallots },
    resultMs: { unit: "ms", value: (run) => run.result.resultMs },
    proverPeakMiB: { unit: "MiB", value: (run) => mean(run.memory.map((m) => m.proveBytes)) / 2 ** 20 },
    provingMemoryMiB: { unit: "MiB", value: (run) => mean(run.memory.map((m) => m.deltaBytes)) / 2 ** 20 },
};

// Contrasts and the outcomes each one is about.
const CONTRASTS: Array<{ name: string; minuend: Workflow; subtrahend: Workflow; outcomes: string[] }> = [
    { name: "publisher-public", minuend: "COMMITMENT_BALLOT_HIDING", subtrahend: "PUBLIC_DISCLOSURE", outcomes: ["proofMs", "witnessMs", "proveMs", "castGas", "provingMemoryMiB"] },
    { name: "reveal-public", minuend: "COMMITMENT_ONCHAIN_REVEAL", subtrahend: "PUBLIC_DISCLOSURE", outcomes: ["proofMs", "castGas", "resultGasPerBallot"] },
    { name: "reveal-publisher", minuend: "COMMITMENT_ONCHAIN_REVEAL", subtrahend: "COMMITMENT_BALLOT_HIDING", outcomes: ["proofMs", "castGas", "resultGasPerBallot", "resultMs"] },
];

const round = (value: number, digits = 3): string => {
    if (!Number.isFinite(value)) return "—";
    const magnitude = Math.abs(value);
    if (magnitude >= 1000) return Math.round(value).toLocaleString("en-US");
    return Number(value.toPrecision(digits)).toString();
};

function main(): void {
    const outputDir = process.argv[2];
    if (!outputDir) throw new Error("usage: analyze.ts <output-dir>");
    const runs: Run[] = fs.readFileSync(path.join(outputDir, "runs.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const artifacts: any[] = JSON.parse(fs.readFileSync(path.join(outputDir, "artifacts.json"), "utf8"));
    const cells = [...new Set(runs.map((run) => run.cellId))];
    const analysisDir = path.join(outputDir, "analysis");
    fs.mkdirSync(analysisDir, { recursive: true });

    // Absolute values per cell and workflow.
    const absolute: Array<Record<string, unknown>> = [];
    for (const cellId of cells) {
        for (const workflow of Object.keys(SHORT) as Workflow[]) {
            const selected = runs.filter((run) => run.cellId === cellId && run.workflow === workflow);
            if (selected.length === 0) continue;
            for (const [outcome, spec] of Object.entries(OUTCOMES)) {
                const values = selected.map(spec.value).filter(Number.isFinite);
                if (values.length === 0) continue;
                absolute.push({ cellId, workflow, outcome, unit: spec.unit, ...describe(values) });
            }
        }
    }

    // Paired contrasts by block, Holm within each outcome-by-contrast family.
    const contrasts: Array<Record<string, any>> = [];
    for (const contrast of CONTRASTS) {
        for (const outcome of contrast.outcomes) {
            const family: Array<Record<string, any>> = [];
            for (const cellId of cells) {
                const byBlock = (workflow: Workflow) => new Map(runs.filter((run) => run.cellId === cellId && run.workflow === workflow).map((run) => [run.block, run]));
                const left = byBlock(contrast.minuend);
                const right = byBlock(contrast.subtrahend);
                const blocks = [...left.keys()].filter((block) => right.has(block));
                if (blocks.length < 2) continue;
                const spec = OUTCOMES[outcome];
                const differences = blocks.map((block) => spec.value(left.get(block)!) - spec.value(right.get(block)!));
                const ratios = blocks.map((block) => spec.value(left.get(block)!) / spec.value(right.get(block)!)).filter(Number.isFinite);
                family.push({ contrast: contrast.name, outcome, unit: spec.unit, cellId, ...pairedTest(differences), meanRatio: ratios.length ? mean(ratios) : NaN });
            }
            const adjusted = holm(family.map((row) => row.p));
            family.forEach((row, index) => { row.holmP = adjusted[index]; });
            contrasts.push(...family);
        }
    }

    // Cost model next to the measurements.
    const model: Array<Record<string, unknown>> = [];
    for (const cellId of cells) {
        const run = runs.find((candidate) => candidate.cellId === cellId)!;
        const artifact = artifacts.find((entry) => entry.configuration === run.configuration);
        if (!artifact) continue;
        const measured = contrasts.find((row) => row.cellId === cellId && row.contrast === "publisher-public" && row.outcome === "proofMs");
        model.push({
            cellId,
            configuration: run.configuration,
            publicConstraints: artifact.public.constraints,
            commitmentConstraints: artifact.commitment.constraints,
            constraintRatio: artifact.commitment.constraints / artifact.public.constraints,
            publicDomain: artifact.public.domainSize,
            commitmentDomain: artifact.commitment.domainSize,
            domainThreshold: artifact.commitment.domainSize !== artifact.public.domainSize,
            measuredProofTimeRatio: measured?.meanRatio ?? NaN,
        });
    }

    fs.writeFileSync(path.join(analysisDir, "summary.json"), JSON.stringify({ absolute, contrasts, model }, null, 2));

    const lines: string[] = [`# Experiment analysis (${new Date().toISOString()})`, "", `Runs: ${runs.length}; cells: ${cells.join(", ")}`, ""];
    lines.push("## Absolute values (mean ± SD over blocks)", "");
    lines.push("| Cell | Outcome | public | publisher | reveal |", "|---|---|---|---|---|");
    for (const cellId of cells) {
        for (const outcome of Object.keys(OUTCOMES)) {
            const cellValue = (workflow: Workflow) => {
                const row = absolute.find((entry) => entry.cellId === cellId && entry.workflow === workflow && entry.outcome === outcome) as any;
                return row ? `${round(row.mean)} ± ${round(row.sd, 2)}` : "—";
            };
            lines.push(`| ${cellId} | ${outcome} (${OUTCOMES[outcome].unit}) | ${cellValue("PUBLIC_DISCLOSURE")} | ${cellValue("COMMITMENT_BALLOT_HIDING")} | ${cellValue("COMMITMENT_ONCHAIN_REVEAL")} |`);
        }
    }
    lines.push("", "## Paired contrasts (per-block differences; Holm within each contrast-by-outcome family)", "");
    lines.push("| Contrast | Outcome | Cell | n | Mean difference [95% CI] | Mean ratio | Holm p |", "|---|---|---|---|---|---|---|");
    for (const row of contrasts) {
        lines.push(`| ${row.contrast} | ${row.outcome} (${row.unit}) | ${row.cellId} | ${row.n} | ${round(row.mean)} [${round(row.ciLow)}, ${round(row.ciHigh)}] | ${round(row.meanRatio)} | ${row.holmP < 0.001 ? "<0.001" : round(row.holmP, 2)} |`);
    }
    lines.push("", "## Cost model against measurement", "");
    lines.push("| Cell | Constraints (public → commitment) | Constraint ratio | Domain (public → commitment) | Measured proof-time ratio |", "|---|---|---|---|---|");
    for (const row of model as any[]) {
        lines.push(`| ${row.cellId} | ${row.publicConstraints} → ${row.commitmentConstraints} | ${round(row.constraintRatio)} | 2^${Math.log2(row.publicDomain)} → 2^${Math.log2(row.commitmentDomain)}${row.domainThreshold ? " (threshold)" : ""} | ${round(row.measuredProofTimeRatio)} |`);
    }
    fs.writeFileSync(path.join(analysisDir, "tables.md"), lines.join("\n") + "\n");
    console.log(`Analysis written to ${analysisDir} (${absolute.length} absolute rows, ${contrasts.length} contrasts)`);
}

main();
