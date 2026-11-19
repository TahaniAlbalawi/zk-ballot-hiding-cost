/**
 * Demo Vote Casting Script
 * Demonstrates casting a vote from the command line
 */
import { ethers, JsonRpcProvider } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
// @ts-ignore
import * as snarkjs from "snarkjs";
import { poseidonHash2 } from "./lib/poseidon.js";
import { assertPublicSignalBinding } from "./lib/publicSignals.js";

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = process.env.CMC_RUN_DATA_DIR ?? join(__dirname, "../data");
const CIRCUITS_DIR = join(__dirname, "../../circuits");
// Demo runs use one configuration bundle produced by `npm run circuits:build`.
const DEMO_CONFIGURATION = process.env.CMC_DEMO_CONFIGURATION ?? "D05-C04";

async function main() {
    console.log("=== Demo Vote Casting ===\n");

    // Load deployment data
    const deployedPath = join(DATA_DIR, "deployed.json");
    const deployed = JSON.parse(readFileSync(deployedPath, "utf-8"));
    console.log(`BallotBox: ${deployed.ballotBox}`);

    // Load electorate data
    const electoratePath = join(DATA_DIR, "electorate.json");
    const electorate = JSON.parse(readFileSync(electoratePath, "utf-8"));

    // Load root data
    const rootPath = join(DATA_DIR, "root.json");
    const rootData = JSON.parse(readFileSync(rootPath, "utf-8"));

    // Get voter index and vote from args or use defaults
    const voterIndex = parseInt(process.env.VOTER_INDEX || "0");
    const vote = parseInt(process.env.VOTE || "1");

    console.log(`Voter index: ${voterIndex}`);
    console.log(`Vote: ${vote}`);

    const voter = electorate.voters[voterIndex];
    if (!voter) {
        throw new Error(`Voter ${voterIndex} not found`);
    }

    // Compute nullifier
    const secret = BigInt(voter.secret);
    const electionId = deployed.electionId;
    const nullifier = await poseidonHash2(secret, BigInt(electionId));
    console.log(`Nullifier: ${nullifier}`);

    // The proof binds the submitting account, so resolve it before proving.
    const provider = new JsonRpcProvider("http://127.0.0.1:8545");
    const accounts = await provider.listAccounts();
    const signer = accounts[0];
    const voterAddress = await signer.getAddress();

    // Prepare circuit inputs
    const circuitInputs = {
        root: rootData.root,
        nullifier: nullifier.toString(),
        electionId: electionId.toString(),
        vote: vote.toString(),
        candidateCount: deployed.candidateCount.toString(),
        voter: BigInt(voterAddress).toString(),
        secret: voter.secret,
        pathElements: voter.pathElements,
        pathIndices: voter.pathIndices,
    };

    console.log("\nGenerating ZK proof...");
    const circuitName = `VoteProof_${DEMO_CONFIGURATION.replace("-", "_")}`;
    const bundleDir = join(CIRCUITS_DIR, "build", "configurations", DEMO_CONFIGURATION, "public");
    const wasmPath = join(bundleDir, `${circuitName}_js`, `${circuitName}.wasm`);
    const zkeyPath = join(bundleDir, `${circuitName}_final.zkey`);

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInputs,
        wasmPath,
        zkeyPath
    );

    const expectedSignals = {
        root: rootData.root,
        nullifier,
        electionId,
        vote,
        candidateCount: deployed.candidateCount,
        voter: voterAddress,
    };
    const signalEvidence = assertPublicSignalBinding(
        "PUBLIC_DISCLOSURE",
        publicSignals,
        expectedSignals
    );

    console.log("Proof generated!");
    console.log(`Public signals: ${publicSignals}`);
    console.log(`Public-signal binding: ${signalEvidence.disposition}`);

    // Convert proof to Solidity format
    const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const [a, b, c, inputs] = JSON.parse(`[${calldata}]`);
    assertPublicSignalBinding("PUBLIC_DISCLOSURE", inputs, expectedSignals);

    console.log("\nSubmitting vote to contract...");

    // Load BallotBox contract
    const artifactsDir = join(__dirname, "../../contracts/artifacts/contracts");
    const ballotBoxArtifact = JSON.parse(
        readFileSync(join(artifactsDir, "BallotBox.sol/BallotBox.json"), "utf-8")
    );

    const ballotBox = new ethers.Contract(deployed.ballotBox, ballotBoxArtifact.abi, signer);

    // Cast vote
    const tx = await ballotBox.castVote(electionId, nullifier, vote, a, b, c);
    const receipt = await tx.wait();

    console.log(`\n✅ Vote cast successfully!`);
    console.log(`Transaction hash: ${receipt.hash}`);
    console.log(`Block number: ${receipt.blockNumber}`);

    // Get results
    const results = await ballotBox.getResults(electionId);
    console.log(`\nCurrent results:`);
    for (let i = 0; i < results.length; i++) {
        console.log(`  Candidate ${i}: ${results[i]} votes`);
    }

    console.log("\n=== Demo complete ===");
}

// Exit explicitly: the JSON-RPC provider otherwise keeps the process alive
// after a successful run (the other CLI scripts follow the same pattern).
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
