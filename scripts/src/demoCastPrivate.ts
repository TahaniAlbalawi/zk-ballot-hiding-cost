/**
 * Demo Cast Private Vote
 * Casts a committed vote in a private commitment-based election
 */
import { ethers } from "ethers";
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { assertPublicSignalBinding } from "./lib/publicSignals.js";
import {
    RetainedOpening,
    retainedOpeningFromReceipt,
} from "./lib/openingReconciliation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.CMC_RUN_DATA_DIR ?? path.join(__dirname, "../data");
const CIRCUITS_DIR = path.join(__dirname, "../../circuits/build");
// Demo runs use one configuration bundle produced by `npm run circuits:build`.
const DEMO_CONFIGURATION = process.env.CMC_DEMO_CONFIGURATION ?? "D05-C04";

interface Voter {
    index: number;
    secret: string;
    leaf: string;
    pathElements: string[];
    pathIndices: number[];
}

interface DeployedAddresses {
    ballotBox: string;
    electionRegistry: string;
    electionId: number;
    candidateCount: number;
    electionType: string;
    workflowMode: "COMMITMENT_BALLOT_HIDING" | "COMMITMENT_ONCHAIN_REVEAL";
}

const BALLOT_BOX_ABI = [
    "function castVotePrivate(uint256 electionId, uint256 nullifier, uint256 commitment, uint256[2] a, uint256[2][2] b, uint256[2] c)",
    "function totalVotes(uint256 electionId) view returns (uint256)",
    "event EncryptedVoteCast(uint256 indexed electionId, uint256 indexed nullifier, uint256 commitment, address voter, bytes32 receiptHash)"
];

interface OpeningFile {
    schemaVersion: "RETAINED-OPENINGS-v3";
    electionId: string;
    capturePartition: "PRIVILEGED_LOCAL";
    captureWindow: "PRE_SECRET_RELEASE";
    releaseState: "NOT_RELEASED";
    openings: RetainedOpening[];
}

function persistAcceptedOpening(auditPath: string, opening: RetainedOpening): void {
    let auditData: OpeningFile = {
        schemaVersion: "RETAINED-OPENINGS-v3",
        electionId: BigInt(opening.electionId).toString(),
        capturePartition: "PRIVILEGED_LOCAL",
        captureWindow: "PRE_SECRET_RELEASE",
        releaseState: "NOT_RELEASED",
        openings: [],
    };
    if (fs.existsSync(auditPath)) {
        const parsed = JSON.parse(fs.readFileSync(auditPath, "utf-8"));
        if (parsed.schemaVersion !== "RETAINED-OPENINGS-v3" || !Array.isArray(parsed.openings)) {
            throw new Error("Existing opening file is legacy or malformed; refusing an implicit migration");
        }
        auditData = parsed;
    }
    if (auditData.electionId !== BigInt(opening.electionId).toString()) {
        throw new Error("Opening file election does not match the accepted vote");
    }
    auditData.openings.push(opening);
    const temporaryPath = `${auditPath}.pending`;
    fs.writeFileSync(temporaryPath, JSON.stringify(auditData, null, 2), { flag: "wx" });
    fs.renameSync(temporaryPath, auditPath);
}

async function main() {
    const voterIndex = parseInt(process.env.VOTER_INDEX || "0");
    const vote = parseInt(process.env.VOTE || "1");

    console.log("=== Casting Private Vote ===\n");
    console.log(`Voter Index: ${voterIndex}`);
    console.log(`Vote: ${vote}`);

    // Load data
    const electoratePath = path.join(DATA_DIR, "electorate.json");
    const deployedPath = path.join(DATA_DIR, "deployed.json");
    const rootPath = path.join(DATA_DIR, "root.json");

    if (!fs.existsSync(electoratePath) || !fs.existsSync(deployedPath)) {
        throw new Error("Missing data files. Run setup and deploy first.");
    }

    const electorate = JSON.parse(fs.readFileSync(electoratePath, "utf-8"));
    const deployed: DeployedAddresses = JSON.parse(fs.readFileSync(deployedPath, "utf-8"));
    const rootData = JSON.parse(fs.readFileSync(rootPath, "utf-8"));

    if (deployed.electionType !== "PRIVATE_ENCRYPTED" && deployed.electionType !== "COMMITMENT_REVEAL") {
        throw new Error("This script is for commitment elections. Use demo-cast for baseline.");
    }

    const voter: Voter = electorate.voters[voterIndex];
    if (!voter) {
        throw new Error(`Voter ${voterIndex} not found`);
    }

    if (vote < 0 || vote >= deployed.candidateCount) {
        throw new Error(`Invalid vote. Must be 0-${deployed.candidateCount - 1}`);
    }

    // The proof binds the submitting account, so resolve it before proving.
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const signer = await provider.getSigner();
    const voterAddress = await signer.getAddress();

    // Initialize Poseidon
    const poseidon = await buildPoseidon();

    // Compute nullifier
    const nullifier = poseidon.F.toObject(
        poseidon([BigInt(voter.secret), BigInt(deployed.electionId)])
    );

    // Generate randomness for commitment
    const fieldPrime = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    const randomness = BigInt(`0x${randomBytes(32).toString("hex")}`) % fieldPrime;

    // Compute commitment: Poseidon(vote, randomness)
    const commitment = poseidon.F.toObject(
        poseidon([BigInt(vote), randomness])
    );

    console.log(`\nNullifier: ${nullifier}`);
    console.log(`Commitment: ${commitment}`);

    // Prepare circuit inputs
    const circuitInputs = {
        root: rootData.root,
        nullifier: nullifier.toString(),
        electionId: deployed.electionId.toString(),
        candidateCount: deployed.candidateCount.toString(),
        commitment: commitment.toString(),
        voter: BigInt(voterAddress).toString(),
        secret: voter.secret,
        pathElements: voter.pathElements,
        pathIndices: voter.pathIndices,
        vote: vote.toString(),
        randomness: randomness.toString()
    };

    // Check if private circuit exists
    const circuitName = `VoteProofPrivate_${DEMO_CONFIGURATION.replace("-", "_")}`;
    const bundleDir = path.join(CIRCUITS_DIR, "configurations", DEMO_CONFIGURATION, "commitment");
    const wasmPath = path.join(bundleDir, `${circuitName}_js`, `${circuitName}.wasm`);
    const zkeyPath = path.join(bundleDir, `${circuitName}_final.zkey`);

    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
        throw new Error("Private circuit artifacts are missing; no transaction or opening record was created");
    }

    // Generate proof
    console.log("\nGenerating ZK proof...");
    const startTime = Date.now();

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInputs,
        wasmPath,
        zkeyPath
    );

    const proofTime = Date.now() - startTime;
    console.log(`Proof generated in ${proofTime}ms`);

    const expectedSignals = {
        root: rootData.root,
        nullifier,
        electionId: deployed.electionId,
        candidateCount: deployed.candidateCount,
        commitment,
        voter: voterAddress,
    };
    const signalEvidence = assertPublicSignalBinding(
        deployed.workflowMode,
        publicSignals,
        expectedSignals
    );
    console.log(`Public-signal binding: ${signalEvidence.disposition}`);

    // Format proof for Solidity
    const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const [a, b, c, solidityInputs] = JSON.parse(`[${calldata}]`);
    assertPublicSignalBinding(
        deployed.workflowMode,
        solidityInputs,
        expectedSignals
    );

    // Connect to BallotBox
    const ballotBox = new ethers.Contract(deployed.ballotBox, BALLOT_BOX_ABI, signer);

    // Cast vote
    console.log("\nSubmitting vote commitment to blockchain...");

    try {
        const tx = await ballotBox.castVotePrivate(
            deployed.electionId,
            nullifier,
            commitment,
            a, b, c
        );

        const receipt = await tx.wait();
        console.log(`\n✓ Vote cast successfully!`);
        console.log(`  Transaction hash: ${receipt.hash}`);
        console.log(`  Block number: ${receipt.blockNumber}`);
        console.log(`  Gas used: ${receipt.gasUsed}`);

        // Retain an opening only after binding it to the unique successful event.
        const auditPath = path.join(DATA_DIR, `private_votes_${deployed.electionId}.json`);
        const opening = retainedOpeningFromReceipt(ballotBox, receipt, {
            electionId: deployed.electionId,
            nullifier,
            commitment,
            vote,
            randomness,
            capturePartition: "PRIVILEGED_LOCAL",
            captureWindow: "PRE_SECRET_RELEASE",
        });
        persistAcceptedOpening(auditPath, opening);
        console.log(`  Opening bound to accepted event: ${opening.openingId}`);

    } catch (err: any) {
        if (err.message.includes("NullifierAlreadyUsed")) {
            console.error("\n✗ Vote rejected: This voter has already voted.");
        } else if (err.message.includes("VotingNotOpen")) {
            console.error("\n✗ Vote rejected: Voting window not open.");
        } else if (err.message.includes("InvalidProof")) {
            console.error("\n✗ Vote rejected: Invalid proof.");
        }
        throw err;
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
