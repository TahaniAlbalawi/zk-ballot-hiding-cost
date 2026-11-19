/**
 * Setup Electorate Script
 * Generates synthetic voter secrets and builds Merkle tree
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { poseidonHash1, poseidonHash2, getFieldPrime } from "./lib/poseidon.js";
import { buildMerkleTree, getMerkleProof } from "./lib/merkleTree.js";
import { createHash, randomBytes } from "crypto";
import { secretSeedCommitment } from "./lib/seedCustody.js";

// Configuration
const DEFAULT_VOTER_COUNT = 32;
const DEFAULT_TREE_DEPTH = 5;
const DATA_DIR = "../data";

interface VoterData {
    index: number;
    secret: string;
    leaf: string;
    pathElements: string[];
    pathIndices: number[];
}

interface ElectorateData {
    voters: VoterData[];
    treeDepth: number;
    voterCount: number;
    seedCommitment: string;
}

interface RootData {
    root: string;
    depth: number;
    voterCount: number;
    seedCommitment: string;
    generatedAt: string;
}

function readPositiveInteger(name: string, fallback: number): number {
    const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

/**
 * Generate deterministic secrets from seed
 */
async function generateSecrets(count: number, seed: string): Promise<bigint[]> {
    const fieldPrime = await getFieldPrime();
    const secrets: bigint[] = [];

    for (let i = 0; i < count; i++) {
        // Use hash-based deterministic generation
        const seedData = `${seed}:voter:${i}`;
        const hash = createHash("sha256").update(seedData).digest("hex");
        // Convert to field element (modulo field prime)
        const value = BigInt("0x" + hash) % fieldPrime;
        secrets.push(value);
    }

    return secrets;
}

async function main() {
    console.log("=== Setting up Electorate ===\n");

    // Get configuration from environment
    const voterCount = readPositiveInteger("VOTER_COUNT", DEFAULT_VOTER_COUNT);
    const treeDepth = readPositiveInteger("TREE_DEPTH", DEFAULT_TREE_DEPTH);
    const seed = process.env.DEMO_SEED || randomBytes(32).toString("hex");
    const seedCommitment = secretSeedCommitment(seed);

    if (treeDepth > 20) {
        throw new Error("TREE_DEPTH above 20 is outside this prototype's bounded setup envelope");
    }
    if (voterCount > 2 ** treeDepth) {
        throw new Error(`VOTER_COUNT ${voterCount} exceeds capacity ${2 ** treeDepth} for TREE_DEPTH ${treeDepth}`);
    }

    console.log(`Configuration:`);
    console.log(`  Voter count: ${voterCount}`);
    console.log(`  Tree depth: ${treeDepth}`);
    console.log(`  Seed commitment: ${seedCommitment}`);
    console.log();

    // Generate voter secrets
    console.log("Generating voter secrets...");
    const secrets = await generateSecrets(voterCount, seed);

    // Compute leaves (leaf = Poseidon(secret))
    console.log("Computing leaf commitments...");
    const leaves: bigint[] = [];
    for (const secret of secrets) {
        const leaf = await poseidonHash1(secret);
        leaves.push(leaf);
    }

    // Build Merkle tree
    console.log("Building Merkle tree...");
    const tree = await buildMerkleTree(leaves, treeDepth);
    console.log(`  Root: ${tree.root.toString()}`);

    // Generate voter data with proofs
    console.log("Generating voter proofs...");
    const voters: VoterData[] = [];
    for (let i = 0; i < voterCount; i++) {
        const proof = getMerkleProof(tree, i);
        voters.push({
            index: i,
            secret: secrets[i].toString(),
            leaf: leaves[i].toString(),
            pathElements: proof.pathElements.map((e) => e.toString()),
            pathIndices: proof.pathIndices,
        });
    }

    // Save electorate data
    const dataPath = process.env.CMC_RUN_DATA_DIR ?? fileURLToPath(new URL(DATA_DIR, import.meta.url));
    if (!existsSync(dataPath)) {
        mkdirSync(dataPath, { recursive: true });
    }

    const electorateData: ElectorateData = {
        voters,
        treeDepth,
        voterCount,
        seedCommitment,
    };

    const electoratePath = `${dataPath}/electorate.json`;
    writeFileSync(electoratePath, JSON.stringify(electorateData, null, 2));
    console.log(`\nSaved electorate data to: ${electoratePath}`);

    // Save root data
    const rootData: RootData = {
        root: tree.root.toString(),
        depth: treeDepth,
        voterCount,
        seedCommitment,
        generatedAt: new Date().toISOString(),
    };

    const rootPath = `${dataPath}/root.json`;
    writeFileSync(rootPath, JSON.stringify(rootData, null, 2));
    console.log(`Saved root data to: ${rootPath}`);

    // Also save as bytes32 for contract deployment
    const rootHex = "0x" + tree.root.toString(16).padStart(64, "0");
    console.log(`\nRoot (bytes32): ${rootHex}`);

    console.log("\n=== Electorate setup complete ===");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
