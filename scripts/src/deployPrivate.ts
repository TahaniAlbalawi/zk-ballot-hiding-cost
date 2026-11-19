/**
 * Deploy Contracts for a Commitment Election
 * COMMITMENT_WORKFLOW=PUBLISHER (default) creates a PRIVATE_ENCRYPTED election whose
 * result a configured actor publishes; COMMITMENT_WORKFLOW=ONCHAIN_REVEAL creates a
 * COMMITMENT_REVEAL election whose result is derived from openings checked on-chain.
 */
import { ethers } from "ethers";
import { poseidonContract } from "circomlibjs";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { hardhatVerifierArtifact, loadConfigurationArtifactBundleForConfiguration, provisionAndCompileConfiguredVerifiers } from "./configArtifacts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.CMC_RUN_DATA_DIR ?? path.join(__dirname, "../data");
const CONTRACTS_DIR = path.join(__dirname, "../../contracts");

function readPositiveInteger(name: string, fallback: number): number {
    const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

type CommitmentWorkflow = "PUBLISHER" | "ONCHAIN_REVEAL";

function readCommitmentWorkflow(): CommitmentWorkflow {
    const value = process.env.COMMITMENT_WORKFLOW ?? "PUBLISHER";
    if (value !== "PUBLISHER" && value !== "ONCHAIN_REVEAL") {
        throw new Error("COMMITMENT_WORKFLOW must be PUBLISHER or ONCHAIN_REVEAL");
    }
    return value;
}

function pairedPublicManifest(commitmentManifest: string): string {
    const modeDirectory = path.dirname(commitmentManifest);
    if (path.basename(modeDirectory) !== "commitment") {
        throw new Error("commitment configuration-artifact manifest must be located in its exact mode directory");
    }
    return path.join(path.dirname(modeDirectory), "public", "configuration-artifact-manifest.json");
}

async function main() {
    console.log("=== Deploying ZK E-Voting Contracts (Private Mode) ===\n");

    // Connect to provider
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const signer = await provider.getSigner();
    const network = await provider.getNetwork();

    console.log(`Connected to network: ${network.name} (chainId: ${network.chainId})`);
    console.log(`Deployer: ${await signer.getAddress()}\n`);

    const requestedDepth = readPositiveInteger("EXPECTED_TREE_DEPTH", 5);
    const requestedCandidates = readPositiveInteger("CANDIDATE_COUNT", 4);
    const workflow = readCommitmentWorkflow();
    const votingWindowSeconds = readPositiveInteger("VOTING_WINDOW_SECONDS", 300);
    const revealWindowSeconds = readPositiveInteger("REVEAL_WINDOW_SECONDS", 300);
    const configurationManifest = process.env.CMC_CONFIGURATION_ARTIFACT_MANIFEST;
    if (process.env.CMC_EVIDENCE_CONTEXT && !configurationManifest) {
        throw new Error("CMC-bound deployment requires the exact configuration-artifact manifest");
    }
    const commitmentBundle = configurationManifest
        ? loadConfigurationArtifactBundleForConfiguration(configurationManifest, "COMMITMENT_BALLOT_HIDING", requestedDepth, requestedCandidates)
        : null;
    const publicBundle = commitmentBundle
        ? loadConfigurationArtifactBundleForConfiguration(pairedPublicManifest(configurationManifest!), "PUBLIC_DISCLOSURE", requestedDepth, requestedCandidates)
        : null;
    const provisionedVerifiers = publicBundle && commitmentBundle
        ? provisionAndCompileConfiguredVerifiers(path.join(CONTRACTS_DIR, ".."), [publicBundle, commitmentBundle])
        : [];
    const [provisionedPublicVerifier, provisionedCommitmentVerifier] = provisionedVerifiers;

    // Load artifacts
    const loadArtifact = (name: string) => {
        const artifactPath = path.join(CONTRACTS_DIR, `artifacts/contracts/${name}.sol/${name}.json`);
        return JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    };

    // Load root
    const rootPath = path.join(DATA_DIR, "root.json");
    if (!fs.existsSync(rootPath)) {
        throw new Error("root.json not found. Run setup-electorate first.");
    }
    const rootData = JSON.parse(fs.readFileSync(rootPath, "utf-8"));
    const expectedDepth = process.env.EXPECTED_TREE_DEPTH ? requestedDepth : rootData.depth;
    const expectedVoterCount = process.env.EXPECTED_VOTER_COUNT
        ? readPositiveInteger("EXPECTED_VOTER_COUNT", rootData.voterCount)
        : rootData.voterCount;
    if (rootData.depth !== expectedDepth || rootData.voterCount !== expectedVoterCount) {
        throw new Error(
            `Electorate configuration mismatch: expected depth=${expectedDepth}, voters=${expectedVoterCount}; ` +
            `observed depth=${rootData.depth}, voters=${rootData.voterCount}`
        );
    }

    // Deploy ElectionRegistry
    console.log("Deploying ElectionRegistry...");
    const registryArtifact = loadArtifact("ElectionRegistry");
    const RegistryFactory = new ethers.ContractFactory(
        registryArtifact.abi,
        registryArtifact.bytecode,
        signer
    );
    const registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log(`  ElectionRegistry deployed at: ${registryAddress}`);

    // Deploy baseline Verifier
    console.log("\nDeploying Baseline Verifier...");
    // snarkjs generates contract with name Groth16Verifier inside Verifier.sol
    const verifierPath = publicBundle ? hardhatVerifierArtifact(path.join(CONTRACTS_DIR, ".."), publicBundle) : path.join(CONTRACTS_DIR, "artifacts/contracts/Verifier.sol/Groth16Verifier.json");
    const verifierArtifact = JSON.parse(fs.readFileSync(verifierPath, "utf-8"));
    const VerifierFactory = new ethers.ContractFactory(
        verifierArtifact.abi,
        verifierArtifact.bytecode,
        signer
    );
    const verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();
    const verifierAddress = await verifier.getAddress();
    console.log(`  Verifier deployed at: ${verifierAddress}`);

    // Deploy private Verifier if available
    const privateVerifierPath = commitmentBundle ? hardhatVerifierArtifact(path.join(CONTRACTS_DIR, ".."), commitmentBundle) : path.join(CONTRACTS_DIR, "artifacts/contracts/VerifierPrivate.sol/Groth16Verifier.json");
    if (!fs.existsSync(privateVerifierPath)) {
        throw new Error("VerifierPrivate artifact not found. Run the frozen circuit build first.");
    }
    console.log("\nDeploying Private Verifier...");
    const privateArtifact = JSON.parse(fs.readFileSync(privateVerifierPath, "utf-8"));
    const PrivateVerifierFactory = new ethers.ContractFactory(
        privateArtifact.abi,
        privateArtifact.bytecode,
        signer
    );
    const verifierPrivate = await PrivateVerifierFactory.deploy();
    await verifierPrivate.waitForDeployment();
    const verifierPrivateAddress = await verifierPrivate.getAddress();
    console.log(`  VerifierPrivate deployed at: ${verifierPrivateAddress}`);

    // Deploy BallotBox
    console.log("\nDeploying BallotBox...");
    const ballotBoxArtifact = loadArtifact("BallotBox");
    const BallotBoxFactory = new ethers.ContractFactory(
        ballotBoxArtifact.abi,
        ballotBoxArtifact.bytecode,
        signer
    );
    const ballotBox = await BallotBoxFactory.deploy(registryAddress, verifierAddress);
    await ballotBox.waitForDeployment();
    const ballotBoxAddress = await ballotBox.getAddress();
    console.log(`  BallotBox deployed at: ${ballotBoxAddress}`);

    // Use ABI-backed Contract instances for methods that are not inferred on
    // the generic BaseContract returned by ContractFactory.deploy().
    const ballotBoxContract = new ethers.Contract(ballotBoxAddress, ballotBoxArtifact.abi, signer);
    const registryContract = new ethers.Contract(registryAddress, registryArtifact.abi, signer);

    // Set private verifier if deployed
    console.log("\nSetting VerifierPrivate on BallotBox...");
    const verifierConfigTx = await ballotBoxContract.setVerifierPrivate(verifierPrivateAddress);
    await verifierConfigTx.wait();
    const configuredVerifier = await ballotBoxContract.verifierPrivate();
    if (String(configuredVerifier).toLowerCase() !== verifierPrivateAddress.toLowerCase()) {
        throw new Error("Private verifier read-back does not match the deployed verifier");
    }
    console.log("  VerifierPrivate set and verified successfully");

    // The reveal workflow checks each opening with the circuit's Poseidon(2).
    let commitmentHasherAddress: string | null = null;
    if (workflow === "ONCHAIN_REVEAL") {
        console.log("\nDeploying Poseidon(2) commitment hasher...");
        const HasherFactory = new ethers.ContractFactory(
            poseidonContract.generateABI(2),
            poseidonContract.createCode(2),
            signer
        );
        const hasher = await HasherFactory.deploy();
        await hasher.waitForDeployment();
        commitmentHasherAddress = await hasher.getAddress();
        const hasherConfigTx = await ballotBoxContract.setCommitmentHasher(commitmentHasherAddress);
        await hasherConfigTx.wait();
        if (String(await ballotBoxContract.commitmentHasher()).toLowerCase() !== commitmentHasherAddress.toLowerCase()) {
            throw new Error("Commitment hasher read-back does not match the deployed hasher");
        }
        console.log(`  Commitment hasher deployed and set at: ${commitmentHasherAddress}`);
    }

    // Create commitment election
    console.log(`\nCreating commitment election (${workflow})...`);
    // Convert decimal root to bytes32 hex format
    const rootBigInt = BigInt(rootData.root);
    const rootHex = "0x" + rootBigInt.toString(16).padStart(64, "0");
    const candidateCount = requestedCandidates;
    // The election window is evaluated by the chain, so it must be anchored
    // to the chain clock rather than the host clock.  A clean local node can
    // legitimately lag the host clock immediately after reset.
    const latestBlock = await provider.getBlock("latest");
    if (!latestBlock) {
        throw new Error("Cannot read the current chain timestamp before creating the election");
    }
    const now = Number(latestBlock.timestamp);
    const startTime = now - 10; // Start immediately (10 seconds ago)
    const endTime = now + votingWindowSeconds;
    const revealEndTime = workflow === "ONCHAIN_REVEAL" ? endTime + revealWindowSeconds : 0;

    const createTx = workflow === "ONCHAIN_REVEAL"
        ? await registryContract.createRevealElection(rootHex, candidateCount, startTime, endTime, revealEndTime)
        : await registryContract.createPrivateElection(rootHex, candidateCount, startTime, endTime);
    const receipt = await createTx.wait();

    // Parse election ID from event
    const electionId = 0; // First election
    const actualElection = await registryContract.getElectionFull(electionId);
    const resultPublisher = await registryContract.getResultPublisher(electionId);
    const signerAddress = await signer.getAddress();
    const expectedType = workflow === "ONCHAIN_REVEAL" ? 2 : 1;
    // The reveal workflow has no result publisher; anyone may reveal and finalize.
    const expectedPublisher = workflow === "ONCHAIN_REVEAL" ? ethers.ZeroAddress : signerAddress;
    if (
        String(actualElection.root).toLowerCase() !== rootHex.toLowerCase() ||
        Number(actualElection.candidateCount) !== candidateCount ||
        Number(actualElection.electionType) !== expectedType ||
        Number(actualElection.revealEndTime) !== revealEndTime ||
        String(resultPublisher).toLowerCase() !== expectedPublisher.toLowerCase()
    ) {
        throw new Error("Deployed commitment election does not match the requested configuration/publisher");
    }

    console.log(`  Commitment election created in tx: ${receipt.hash}`);
    console.log(`  Election ID: ${electionId}`);
    console.log(`  Candidate count: ${candidateCount}`);
    console.log(`  Voting window: ${new Date(startTime * 1000).toISOString()} - ${new Date(endTime * 1000).toISOString()}`);
    if (workflow === "ONCHAIN_REVEAL") {
        console.log(`  Reveal deadline: ${new Date(revealEndTime * 1000).toISOString()}`);
    }

    // Save deployment data
    const deployedData = {
        network: network.name,
        chainId: Number(network.chainId),
        electionRegistry: registryAddress,
        verifier: verifierAddress,
        verifierPrivate: verifierPrivateAddress,
        ballotBox: ballotBoxAddress,
        electionId,
        candidateCount,
        electionType: workflow === "ONCHAIN_REVEAL" ? "COMMITMENT_REVEAL" : "PRIVATE_ENCRYPTED",
        workflowMode: workflow === "ONCHAIN_REVEAL" ? "COMMITMENT_ONCHAIN_REVEAL" : "COMMITMENT_BALLOT_HIDING",
        resultPublisher,
        commitmentHasher: commitmentHasherAddress,
        revealEndTime,
        treeDepth: rootData.depth,
        voterCount: rootData.voterCount,
        seedCommitment: rootData.seedCommitment,
        selectedVerifiers: provisionedPublicVerifier && provisionedCommitmentVerifier ? {
            public: { ...provisionedPublicVerifier, deployment_role: "PUBLIC_VERIFIER", deployed_address: verifierAddress },
            commitment: { ...provisionedCommitmentVerifier, deployment_role: "COMMITMENT_VERIFIER", deployed_address: verifierPrivateAddress },
        } : null,
        startTime,
        endTime,
        deployedAt: new Date().toISOString()
    };

    const deployedPath = path.join(DATA_DIR, "deployed.json");
    fs.writeFileSync(deployedPath, JSON.stringify(deployedData, null, 2));
    console.log(`\nSaved deployment data to: ${deployedPath}`);

    console.log("\n=== Private Deployment complete ===");
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
