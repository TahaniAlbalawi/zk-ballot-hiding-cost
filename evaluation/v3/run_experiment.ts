/**
 * v0.3 three-workflow matched experiment runner.
 *
 * For every design cell and block: reset the local chain, deploy once, then run
 * the three workflows in a balanced order.  Within a block every workflow casts
 * the same planned ballots (same voters, candidate schedule and commitment
 * randomness) in its own election, then derives its result:
 *   PUBLIC_DISCLOSURE          counts recomputed from VoteCast events
 *   COMMITMENT_BALLOT_HIDING   openings reconciled off-chain, published by the configured publisher
 *   COMMITMENT_ONCHAIN_REVEAL  openings revealed and checked on-chain, then finalized
 * Proof timing runs with nothing else in the process; peak prover memory is
 * measured afterwards in isolated processes (see measure.ts).
 *
 * All three records of a block are appended to runs.jsonl together, so an
 * interrupted run resumes at the first incomplete block.
 *
 * Usage: tsx evaluation/v3/run_experiment.ts <design.json> <output-dir>
 */
import { ethers } from "ethers";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPoseidon, poseidonContract } from "circomlibjs";
import { assertPublicSignalBinding } from "../../scripts/src/lib/publicSignals.js";
import {
    assertPublishableReconciliation,
    captureAcceptedCommitmentSnapshot,
    reconcileOpenings,
    retainedOpeningFromReceipt,
    type RetainedOpening,
} from "../../scripts/src/lib/openingReconciliation.js";
import { submitReconciledTally } from "../../scripts/src/lib/tallySubmission.js";
import { finalizeRevealedElection, revealRetainedOpenings } from "../../scripts/src/lib/onchainReveal.js";
import { calldataGas, measureProverMemory, solidityProof, timeProof, timeVerify, type ProverMemory } from "./measure.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RPC_URL = "http://127.0.0.1:8545";
const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const WORKFLOWS = ["PUBLIC_DISCLOSURE", "COMMITMENT_BALLOT_HIDING", "COMMITMENT_ONCHAIN_REVEAL"] as const;
type Workflow = typeof WORKFLOWS[number];
// All six orders, cycled across blocks so that each occurs equally often.
const ORDERS: Workflow[][] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
    .map((order) => order.map((index) => WORKFLOWS[index]));
// Generous windows; the runner closes elections by advancing chain time.
const VOTING_WINDOW_SECONDS = 1_000_000;
const REVEAL_WINDOW_SECONDS = 1_000_000;

interface Cell {
    id: string;
    family: string;
    depth: number;
    candidates: number;
    electorate: number;
    ballots: number;
    blocks: number;
}

interface Design {
    schemaVersion: "ZKV-EXPERIMENT-DESIGN-v3";
    seed: string;
    warmupProofs: number;
    memorySamplesPerRun: number;
    revealBatchSize: number;
    cells: Cell[];
}

interface CircuitArtifacts {
    wasm: string;
    zkey: string;
    verificationKey: unknown;
    verifierArtifact: any;
}

interface BallotRecord {
    index: number;
    vote: number;
    witnessMs: number;
    proveMs: number;
    verifyMs: number;
    castGas: number;
    calldataBytes: number;
    calldataGas: number;
    txMs: number;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");
const configurationId = (cell: Cell): string => `D${pad2(cell.depth)}-C${pad2(cell.candidates)}`;
const elapsedMs = (since: bigint): number => Number(process.hrtime.bigint() - since) / 1e6;

function deriveField(seed: string, ...parts: Array<string | number | bigint>): bigint {
    const digest = crypto.createHash("sha256").update([seed, ...parts.map(String)].join("|")).digest("hex");
    return BigInt(`0x${digest}`) % FIELD_PRIME;
}

function sha256File(file: string): string {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function loadArtifact(relativePath: string): any {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "artifacts", "contracts", relativePath), "utf8"));
}

function circuitArtifacts(cell: Cell, mode: "public" | "commitment"): CircuitArtifacts {
    const id = configurationId(cell);
    const name = `${mode === "public" ? "VoteProof" : "VoteProofPrivate"}_${id.replace("-", "_")}`;
    const bundle = path.join(ROOT, "circuits", "build", "configurations", id, mode);
    const verificationKeyFile = fs.readdirSync(bundle).find((file) => file.endsWith("verification_key.json"));
    if (!verificationKeyFile) throw new Error(`no verification key in ${bundle}; run npm run circuits:build`);
    const verifier = `${mode === "public" ? "VerifierPublic" : "VerifierCommitment"}_${id.replace("-", "")}`;
    const contractName = `Groth16Verifier${mode === "public" ? "Public" : "Commitment"}${id.replace("-", "")}`;
    return {
        wasm: path.join(bundle, `${name}_js`, `${name}.wasm`),
        zkey: path.join(bundle, `${name}_final.zkey`),
        verificationKey: JSON.parse(fs.readFileSync(path.join(bundle, verificationKeyFile), "utf8")),
        verifierArtifact: loadArtifact(`cmc_verifiers/${verifier}.sol/${contractName}.json`),
    };
}

/** Header fields of a circom .r1cs file (section 1). */
function r1csHeader(file: string): { constraints: number; publicInputs: number; outputs: number; wires: number } {
    const buffer = fs.readFileSync(file);
    let offset = 12;
    for (let section = 0; section < buffer.readUInt32LE(8); section++) {
        const type = buffer.readUInt32LE(offset);
        const size = Number(buffer.readBigUInt64LE(offset + 4));
        const start = offset + 12;
        if (type === 1) {
            const fieldBytes = buffer.readUInt32LE(start);
            const p = start + 4 + fieldBytes;
            return {
                wires: buffer.readUInt32LE(p),
                outputs: buffer.readUInt32LE(p + 4),
                publicInputs: buffer.readUInt32LE(p + 8),
                constraints: buffer.readUInt32LE(p + 24),
            };
        }
        offset = start + size;
    }
    throw new Error(`no header section in ${file}`);
}

/** Groth16 domain size recorded in a snarkjs .zkey header (section 2). */
function zkeyDomainSize(file: string): number {
    const buffer = fs.readFileSync(file);
    let offset = 12;
    for (let section = 0; section < buffer.readUInt32LE(8); section++) {
        const type = buffer.readUInt32LE(offset);
        const size = Number(buffer.readBigUInt64LE(offset + 4));
        const start = offset + 12;
        if (type === 2) {
            let p = start + 4 + buffer.readUInt32LE(start);
            p += 4 + buffer.readUInt32LE(p);
            return buffer.readUInt32LE(p + 8);
        }
        offset = start + size;
    }
    throw new Error(`no Groth16 header in ${file}`);
}

function artifactSummary(cell: Cell): Record<string, unknown> {
    const id = configurationId(cell);
    const summary: Record<string, unknown> = { configuration: id, depth: cell.depth, candidates: cell.candidates };
    for (const mode of ["public", "commitment"] as const) {
        const name = `${mode === "public" ? "VoteProof" : "VoteProofPrivate"}_${id.replace("-", "_")}`;
        const bundle = path.join(ROOT, "circuits", "build", "configurations", id, mode);
        const zkey = path.join(bundle, `${name}_final.zkey`);
        const wasm = path.join(bundle, `${name}_js`, `${name}.wasm`);
        summary[mode] = {
            ...r1csHeader(path.join(bundle, `${name}.r1cs`)),
            domainSize: zkeyDomainSize(zkey),
            zkeyBytes: fs.statSync(zkey).size,
            wasmBytes: fs.statSync(wasm).size,
        };
    }
    return summary;
}

function packageVersion(name: string): string {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8")).version;
}

function sourceManifest(): Record<string, string> {
    const roots = ["circuits/circuits", "contracts/contracts", "scripts/src/lib", "evaluation/v3"];
    const manifest: Record<string, string> = {};
    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
            const relative = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(relative);
            else if (/\.(circom|sol|ts|mjs)$/.test(entry.name)) manifest[relative] = sha256File(path.join(ROOT, relative));
        }
    };
    roots.forEach(walk);
    return manifest;
}

function environmentRecord(): Record<string, unknown> {
    const cpus = os.cpus();
    const sources = sourceManifest();
    return {
        recordedAt: new Date().toISOString(),
        node: process.version,
        platform: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        cpuModel: cpus[0]?.model ?? "unknown",
        logicalCores: cpus.length,
        memoryBytes: os.totalmem(),
        circom: spawnSync("circom", ["--version"], { encoding: "utf8" }).stdout.trim(),
        snarkjs: packageVersion("snarkjs"),
        circomlibjs: packageVersion("circomlibjs"),
        hardhat: packageVersion("hardhat"),
        ethers: packageVersion("ethers"),
        powersOfTauSha256: sha256File(path.join(ROOT, "circuits", "build", "ppot_0080_14.ptau")),
        sourceManifestSha256: crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex"),
        sourceManifest: sources,
    };
}

async function rpcReady(): Promise<boolean> {
    try {
        const response = await fetch(RPC_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

async function ensureLocalNode(): Promise<ChildProcess | null> {
    if (await rpcReady()) return null;
    const node = spawn(path.join(ROOT, "node_modules", ".bin", "hardhat"), ["node"], {
        cwd: path.join(ROOT, "contracts"),
        stdio: "ignore",
    });
    for (let attempt = 0; attempt < 120; attempt++) {
        if (await rpcReady()) return node;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    node.kill();
    throw new Error("local Hardhat node did not start");
}

async function advancePast(provider: ethers.JsonRpcProvider, boundary: number): Promise<void> {
    const latest = await provider.getBlock("latest");
    if (!latest) throw new Error("cannot read the latest block");
    const delta = boundary + 1 - Number(latest.timestamp);
    if (delta > 0) await provider.send("evm_increaseTime", [delta]);
    await provider.send("evm_mine", []);
}

async function deploy(artifact: { abi: any; bytecode: string }, signer: ethers.Signer, args: unknown[] = []): Promise<{ contract: any; gas: number }> {
    const contract: any = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
    const receipt = await contract.deploymentTransaction()!.wait();
    return { contract, gas: Number(receipt.gasUsed) };
}

async function buildElectorate(poseidon: any, seed: string, cell: Cell) {
    const hash = (inputs: bigint[]): bigint => poseidon.F.toObject(poseidon(inputs));
    if (cell.electorate > 2 ** cell.depth || cell.ballots > cell.electorate) {
        throw new Error(`${cell.id}: need ballots <= electorate <= 2^depth`);
    }
    const secrets = Array.from({ length: cell.electorate }, (_, i) => deriveField(seed, "credential", cell.id, i));
    // Sparse tree: only the populated prefix is hashed; empty subtrees use zero hashes.
    const zeros = [0n];
    for (let level = 0; level < cell.depth; level++) zeros.push(hash([zeros[level], zeros[level]]));
    const levels: bigint[][] = [secrets.map((secret) => hash([secret]))];
    for (let level = 0; level < cell.depth; level++) {
        const below = levels[level];
        const above: bigint[] = [];
        for (let i = 0; i < below.length; i += 2) above.push(hash([below[i], i + 1 < below.length ? below[i + 1] : zeros[level]]));
        levels.push(above);
    }
    const pathOf = (leafIndex: number) => {
        const pathElements: string[] = [];
        const pathIndices: number[] = [];
        let index = leafIndex;
        for (let level = 0; level < cell.depth; level++) {
            const sibling = index ^ 1;
            pathElements.push((sibling < levels[level].length ? levels[level][sibling] : zeros[level]).toString());
            pathIndices.push(index & 1);
            index >>= 1;
        }
        return { pathElements, pathIndices };
    };
    return { secrets, root: levels[cell.depth][0], pathOf, hash };
}

interface BlockContext {
    design: Design;
    cell: Cell;
    block: number;
    provider: ethers.JsonRpcProvider;
    account: string;
    registry: any;
    ballotBox: any;
    verifiers: Record<"public" | "commitment", any>;
    electorate: Awaited<ReturnType<typeof buildElectorate>>;
    circuits: Record<"public" | "commitment", CircuitArtifacts>;
}

async function runWorkflow(context: BlockContext, workflow: Workflow, orderPosition: number): Promise<Record<string, unknown>> {
    const { design, cell, block, provider, account, registry, ballotBox, electorate } = context;
    const startedAt = new Date().toISOString();
    const commitmentMode = workflow !== "PUBLIC_DISCLOSURE";
    const circuit = context.circuits[commitmentMode ? "commitment" : "public"];

    // Each workflow gets its own election, opened at the current chain time.
    const latest = await provider.getBlock("latest");
    const start = Number(latest!.timestamp) - 10;
    const end = start + VOTING_WINDOW_SECONDS;
    const revealEnd = end + REVEAL_WINDOW_SECONDS;
    const rootHex = ethers.toBeHex(electorate.root, 32);
    const electionId: bigint = await registry.electionCount();
    const createTx = workflow === "PUBLIC_DISCLOSURE"
        ? await registry.createElection(rootHex, cell.candidates, start, end)
        : workflow === "COMMITMENT_BALLOT_HIDING"
            ? await registry.createPrivateElection(rootHex, cell.candidates, start, end)
            : await registry.createRevealElection(rootHex, cell.candidates, start, end, revealEnd);
    const electionCreateGas = Number((await createTx.wait()).gasUsed);

    const inputFor = (index: number) => {
        const vote = Number(deriveField(design.seed, "vote", cell.id, block, index) % BigInt(cell.candidates));
        const randomness = deriveField(design.seed, "opening", cell.id, block, index);
        const nullifier = electorate.hash([electorate.secrets[index], electionId]);
        const commitment = electorate.hash([BigInt(vote), randomness]);
        const base = {
            root: electorate.root.toString(),
            nullifier: nullifier.toString(),
            electionId: electionId.toString(),
            candidateCount: String(cell.candidates),
            voter: BigInt(account).toString(),
            secret: electorate.secrets[index].toString(),
            ...electorate.pathOf(index),
        };
        const input = commitmentMode
            ? { ...base, commitment: commitment.toString(), vote: String(vote), randomness: randomness.toString() }
            : { ...base, vote: String(vote) };
        return { vote, randomness, nullifier, commitment, input };
    };

    for (let warmup = 0; warmup < design.warmupProofs; warmup++) {
        await timeProof(inputFor(0).input, circuit.wasm, circuit.zkey);
    }

    const ballotRecords: BallotRecord[] = [];
    const openings: RetainedOpening[] = [];
    let lastProof: { proof: any; publicSignals: string[] } | null = null;
    for (let index = 0; index < cell.ballots; index++) {
        const { vote, randomness, nullifier, commitment, input } = inputFor(index);
        const timing = await timeProof(input, circuit.wasm, circuit.zkey);
        assertPublicSignalBinding(workflow, timing.publicSignals, commitmentMode
            ? { root: electorate.root, nullifier, electionId, candidateCount: cell.candidates, commitment, voter: account }
            : { root: electorate.root, nullifier, electionId, vote, candidateCount: cell.candidates, voter: account });
        const verification = await timeVerify(circuit.verificationKey, timing.publicSignals, timing.proof);
        if (!verification.valid) throw new Error(`${cell.id}/${block}/${workflow}: proof ${index} failed off-chain verification`);

        const p = solidityProof(timing.proof);
        const sentAt = process.hrtime.bigint();
        const tx = commitmentMode
            ? await ballotBox.castVotePrivate(electionId, nullifier, commitment, p.a, p.b, p.c)
            : await ballotBox.castVote(electionId, nullifier, vote, p.a, p.b, p.c);
        const receipt = await tx.wait();
        const txMs = elapsedMs(sentAt);
        ballotRecords.push({
            index,
            vote,
            witnessMs: timing.witnessMs,
            proveMs: timing.proveMs,
            verifyMs: verification.verifyMs,
            castGas: Number(receipt.gasUsed),
            calldataBytes: (tx.data.length - 2) / 2,
            calldataGas: calldataGas(tx.data),
            txMs,
        });
        if (commitmentMode) {
            openings.push(retainedOpeningFromReceipt(ballotBox, receipt, {
                electionId, nullifier, commitment, vote, randomness,
                capturePartition: "PRIVILEGED_LOCAL",
                captureWindow: "PRE_SECRET_RELEASE",
            }));
        }
        lastProof = timing;
    }

    // Verifier execution cost for one proof: eth_estimateGas on the verifier
    // alone, minus the transaction base cost and its calldata.
    const verifier = context.verifiers[commitmentMode ? "commitment" : "public"];
    const lastSolidity = solidityProof(lastProof!.proof);
    const verifyData = verifier.interface.encodeFunctionData("verifyProof", [lastSolidity.a, lastSolidity.b, lastSolidity.c, lastProof!.publicSignals]);
    const verifyEstimate = Number(await provider.estimateGas({ to: await verifier.getAddress(), data: verifyData }));
    const verifierExecutionGas = verifyEstimate - 21000 - calldataGas(verifyData);

    let result: Record<string, unknown>;
    if (workflow === "PUBLIC_DISCLOSURE") {
        const started = process.hrtime.bigint();
        const events = await ballotBox.queryFilter(ballotBox.filters.VoteCast(electionId), 0, "latest");
        const counts = new Array(cell.candidates).fill(0);
        for (const event of events) counts[Number(event.args.vote)]++;
        const onchain = (await ballotBox.getResults(electionId)).map(Number);
        if (JSON.stringify(counts) !== JSON.stringify(onchain)) throw new Error("public recomputation differs from contract counts");
        result = { counts, events: events.length, recomputeMs: elapsedMs(started), resultMs: elapsedMs(started), resultGas: 0 };
    } else if (workflow === "COMMITMENT_BALLOT_HIDING") {
        await advancePast(provider, end);
        const reconcileStarted = process.hrtime.bigint();
        const snapshot = await captureAcceptedCommitmentSnapshot(provider, ballotBox, electionId, 0, await provider.getBlockNumber());
        const reconciliation = await reconcileOpenings({
            acceptedSnapshot: snapshot,
            openings,
            candidateCount: cell.candidates,
            plannedBallots: cell.ballots,
            submittedAttempts: cell.ballots,
            evidencePartition: "PRIVILEGED_LOCAL",
            evidenceWindow: "POST_SECRET_RELEASE",
        });
        assertPublishableReconciliation(reconciliation);
        const reconcileMs = elapsedMs(reconcileStarted);
        const publishStarted = process.hrtime.bigint();
        const publication = await submitReconciledTally(ballotBox, electionId, reconciliation, account, 1, { onPrepared: () => undefined });
        const publishGas = Number((await provider.getTransactionReceipt(publication.transactionHash))!.gasUsed);
        const publishMs = elapsedMs(publishStarted);
        const finalizeStarted = process.hrtime.bigint();
        const finalizeGas = Number((await (await ballotBox.finalizeTally(electionId)).wait()).gasUsed);
        const finalizeMs = elapsedMs(finalizeStarted);
        result = {
            counts: reconciliation.counts,
            reconcileMs, publishMs, finalizeMs,
            resultMs: reconcileMs + publishMs + finalizeMs,
            publishGas, finalizeGas,
            resultGas: publishGas + finalizeGas,
        };
    } else {
        await advancePast(provider, end);
        const revealStarted = process.hrtime.bigint();
        const reveal = await revealRetainedOpenings(ballotBox, electionId, openings, design.revealBatchSize);
        const revealMs = elapsedMs(revealStarted);
        if (reveal.unrevealed !== 0) throw new Error(`${reveal.unrevealed} commitments were left unrevealed`);
        await advancePast(provider, revealEnd);
        const finalizeStarted = process.hrtime.bigint();
        const finalization = await finalizeRevealedElection(ballotBox, electionId);
        const finalizeMs = elapsedMs(finalizeStarted);
        const revealGas = reveal.batches.reduce((sum, batch) => sum + Number(batch.gasUsed), 0);
        const finalizeGas = Number(finalization.gasUsed);
        result = {
            counts: finalization.counts.map(Number),
            revealBatches: reveal.batches.length,
            revealBatchGas: reveal.batches.map((batch) => Number(batch.gasUsed)),
            revealMs, finalizeMs,
            resultMs: revealMs + finalizeMs,
            revealGas, finalizeGas,
            resultGas: revealGas + finalizeGas,
            unrevealed: finalization.unrevealed,
        };
    }

    // Peak memory afterwards, in isolated processes, so it cannot perturb timing.
    const memory: ProverMemory[] = [];
    for (let index = 0; index < Math.min(design.memorySamplesPerRun, cell.ballots); index++) {
        memory.push(measureProverMemory(inputFor(index).input, circuit.wasm, circuit.zkey));
    }

    return {
        schemaVersion: "ZKV-RUN-v3",
        cellId: cell.id,
        family: cell.family,
        configuration: configurationId(cell),
        depth: cell.depth,
        candidates: cell.candidates,
        electorate: cell.electorate,
        plannedBallots: cell.ballots,
        block,
        workflow,
        orderPosition,
        electionId: electionId.toString(),
        electionCreateGas,
        verifierExecutionGas,
        ballots: ballotRecords,
        memory,
        result,
        startedAt,
        endedAt: new Date().toISOString(),
    };
}

const CSV_COLUMNS = ["cellId", "configuration", "depth", "candidates", "electorate", "plannedBallots", "block", "workflow", "orderPosition",
    "index", "vote", "witnessMs", "proveMs", "verifyMs", "castGas", "calldataBytes", "calldataGas", "txMs"] as const;

function appendBlock(outputDir: string, records: Array<Record<string, any>>): void {
    fs.appendFileSync(path.join(outputDir, "runs.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    const csvPath = path.join(outputDir, "ballots.csv");
    if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, CSV_COLUMNS.join(",") + "\n");
    const rows: string[] = [];
    for (const record of records) {
        for (const ballot of record.ballots as BallotRecord[]) {
            const row: Record<string, unknown> = { ...record, ...ballot };
            rows.push(CSV_COLUMNS.map((column) => String(row[column])).join(","));
        }
    }
    fs.appendFileSync(csvPath, rows.join("\n") + "\n");
}

function completedBlocks(outputDir: string): Set<string> {
    const file = path.join(outputDir, "runs.jsonl");
    const seen = new Map<string, Set<string>>();
    if (fs.existsSync(file)) {
        for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
            const record = JSON.parse(line);
            const key = `${record.cellId}|${record.block}`;
            if (!seen.has(key)) seen.set(key, new Set());
            seen.get(key)!.add(record.workflow);
        }
    }
    return new Set([...seen].filter(([, workflows]) => workflows.size === WORKFLOWS.length).map(([key]) => key));
}

async function main(): Promise<void> {
    const [designPath, outputDir] = process.argv.slice(2);
    if (!designPath || !outputDir) throw new Error("usage: run_experiment.ts <design.json> <output-dir>");
    const design: Design = JSON.parse(fs.readFileSync(designPath, "utf8"));
    if (design.schemaVersion !== "ZKV-EXPERIMENT-DESIGN-v3") throw new Error("unsupported design schema");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.copyFileSync(designPath, path.join(outputDir, "design.json"));
    fs.writeFileSync(path.join(outputDir, `environment-${Date.now()}.json`), JSON.stringify(environmentRecord(), null, 2));
    const configurations = new Map(design.cells.map((cell) => [configurationId(cell), artifactSummary(cell)]));
    fs.writeFileSync(path.join(outputDir, "artifacts.json"), JSON.stringify([...configurations.values()], null, 2));

    const node = await ensureLocalNode();
    const poseidon = await buildPoseidon();
    const done = completedBlocks(outputDir);
    const registryArtifact = loadArtifact("ElectionRegistry.sol/ElectionRegistry.json");
    const ballotBoxArtifact = loadArtifact("BallotBox.sol/BallotBox.json");
    try {
        for (const cell of design.cells) {
            const electorate = await buildElectorate(poseidon, design.seed, cell);
            const circuits = { public: circuitArtifacts(cell, "public"), commitment: circuitArtifacts(cell, "commitment") };
            const orderOffset = Number(deriveField(design.seed, "order", cell.id) % 6n);
            for (let block = 1; block <= cell.blocks; block++) {
                if (done.has(`${cell.id}|${block}`)) continue;
                const blockStarted = process.hrtime.bigint();
                // A fresh chain per block; a fresh provider avoids cached chain state.
                await new ethers.JsonRpcProvider(RPC_URL).send("hardhat_reset", []);
                const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: -1 });
                const signer = await provider.getSigner(0);
                const account = await signer.getAddress();
                const registry = await deploy(registryArtifact, signer);
                const verifierPublic = await deploy(circuits.public.verifierArtifact, signer);
                const verifierCommitment = await deploy(circuits.commitment.verifierArtifact, signer);
                const ballotBox = await deploy(ballotBoxArtifact, signer, [await registry.contract.getAddress(), await verifierPublic.contract.getAddress()]);
                const setVerifierGas = Number((await (await ballotBox.contract.setVerifierPrivate(await verifierCommitment.contract.getAddress())).wait()).gasUsed);
                const hasher = await deploy({ abi: poseidonContract.generateABI(2), bytecode: poseidonContract.createCode(2) }, signer);
                const setHasherGas = Number((await (await ballotBox.contract.setCommitmentHasher(await hasher.contract.getAddress())).wait()).gasUsed);
                const setupGas = {
                    registry: registry.gas, verifierPublic: verifierPublic.gas, verifierCommitment: verifierCommitment.gas,
                    ballotBox: ballotBox.gas, setVerifierPrivate: setVerifierGas, poseidonHasher: hasher.gas, setCommitmentHasher: setHasherGas,
                };
                const context: BlockContext = {
                    design, cell, block, provider, account,
                    registry: registry.contract,
                    ballotBox: ballotBox.contract,
                    verifiers: { public: verifierPublic.contract, commitment: verifierCommitment.contract },
                    electorate, circuits,
                };
                const order = ORDERS[(orderOffset + block - 1) % ORDERS.length];
                const records: Array<Record<string, any>> = [];
                for (const [position, workflow] of order.entries()) {
                    records.push({ ...(await runWorkflow(context, workflow, position + 1)), setupGas });
                }
                appendBlock(outputDir, records);
                const summary = records.map((record) => {
                    const prove = (record.ballots as BallotRecord[]).reduce((sum, b) => sum + b.proveMs + b.witnessMs, 0) / record.ballots.length;
                    return `${record.workflow.replace("COMMITMENT_", "").slice(0, 10)}=${prove.toFixed(0)}ms`;
                }).join(" ");
                console.log(`${cell.id} block ${block}/${cell.blocks} [${order.map((w) => w[0]).join("")}] ${summary} (${(elapsedMs(blockStarted) / 1000).toFixed(1)}s)`);
            }
        }
    } finally {
        node?.kill();
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
