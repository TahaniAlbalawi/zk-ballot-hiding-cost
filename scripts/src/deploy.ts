/**
 * Deployment Script
 * Deploys contracts and creates initial election
 */
import { ethers, JsonRpcProvider } from "ethers";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { hardhatVerifierArtifact, loadConfigurationArtifactBundleForConfiguration, provisionAndCompileConfiguredVerifiers } from "./configArtifacts.js";

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = process.env.CMC_RUN_DATA_DIR ?? join(__dirname, "../data");
const CONTRACTS_DIR = join(__dirname, "../../contracts");

interface DeployedAddresses {
    network: string;
    chainId: number;
    electionRegistry: string;
    verifier: string;
    ballotBox: string;
    electionId: number;
    candidateCount: number;
    treeDepth: number;
    voterCount: number;
    seedCommitment: string;
    workflowMode: "PUBLIC_DISCLOSURE";
    selectedVerifier: Record<string, unknown> | null;
    deployedAt: string;
}

function readPositiveInteger(name: string, fallback: number): number {
    const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

async function main() {
    console.log("=== Deploying ZK E-Voting Contracts ===\n");

    // Connect to local Hardhat node
    const provider = new JsonRpcProvider("http://127.0.0.1:8545");
    const network = await provider.getNetwork();
    console.log(`Connected to network: ${network.name} (chainId: ${network.chainId})`);

    // Get deployer account (first Hardhat account)
    const accounts = await provider.listAccounts();
    if (accounts.length === 0) {
        throw new Error("No accounts available. Is Hardhat node running?");
    }
    const deployer = accounts[0];
    console.log(`Deployer: ${deployer.address}`);

    const requestedDepth = readPositiveInteger("EXPECTED_TREE_DEPTH", 5);
    const requestedCandidates = readPositiveInteger("CANDIDATE_COUNT", 4);
    const configurationManifest = process.env.CMC_CONFIGURATION_ARTIFACT_MANIFEST;
    if (process.env.CMC_EVIDENCE_CONTEXT && !configurationManifest) {
        throw new Error("CMC-bound deployment requires the exact configuration-artifact manifest");
    }
    const configurationBundle = configurationManifest
        ? loadConfigurationArtifactBundleForConfiguration(configurationManifest, "PUBLIC_DISCLOSURE", requestedDepth, requestedCandidates)
        : null;
    const provisionedVerifier = configurationBundle
        ? provisionAndCompileConfiguredVerifiers(join(CONTRACTS_DIR, ".."), [configurationBundle])[0]
        : null;

    // Load compiled contract artifacts
    const artifactsDir = join(CONTRACTS_DIR, "artifacts/contracts");

    const registryArtifact = JSON.parse(
        readFileSync(join(artifactsDir, "ElectionRegistry.sol/ElectionRegistry.json"), "utf-8")
    );
    const verifierArtifact = JSON.parse(readFileSync(
        configurationBundle ? hardhatVerifierArtifact(join(CONTRACTS_DIR, ".."), configurationBundle) : join(artifactsDir, "Verifier.sol/Groth16Verifier.json"),
        "utf-8"
    ));
    const ballotBoxArtifact = JSON.parse(
        readFileSync(join(artifactsDir, "BallotBox.sol/BallotBox.json"), "utf-8")
    );

    // Deploy ElectionRegistry
    console.log("\nDeploying ElectionRegistry...");
    const RegistryFactory = new ethers.ContractFactory(
        registryArtifact.abi,
        registryArtifact.bytecode,
        deployer
    );
    const registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log(`  ElectionRegistry deployed at: ${registryAddress}`);

    // Deploy Verifier
    console.log("\nDeploying Verifier...");
    const VerifierFactory = new ethers.ContractFactory(
        verifierArtifact.abi,
        verifierArtifact.bytecode,
        deployer
    );
    const verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();
    const verifierAddress = await verifier.getAddress();
    console.log(`  Verifier deployed at: ${verifierAddress}`);

    // Deploy BallotBox
    console.log("\nDeploying BallotBox...");
    const BallotBoxFactory = new ethers.ContractFactory(
        ballotBoxArtifact.abi,
        ballotBoxArtifact.bytecode,
        deployer
    );
    const ballotBox = await BallotBoxFactory.deploy(registryAddress, verifierAddress);
    await ballotBox.waitForDeployment();
    const ballotBoxAddress = await ballotBox.getAddress();
    console.log(`  BallotBox deployed at: ${ballotBoxAddress}`);

    // Load root from electorate setup
    const rootPath = join(DATA_DIR, "root.json");
    if (!existsSync(rootPath)) {
        throw new Error("Root data not found. Run setup-electorate first.");
    }
    const rootData = JSON.parse(readFileSync(rootPath, "utf-8"));
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
    const root = "0x" + BigInt(rootData.root).toString(16).padStart(64, "0");

    // Create election
    console.log("\nCreating election...");
    const candidateCount = requestedCandidates;
    // The election window is evaluated by the chain, so it must be anchored
    // to the chain clock rather than the host clock.  A clean local node can
    // legitimately lag the host clock immediately after reset.
    const latestBlock = await provider.getBlock("latest");
    if (!latestBlock) {
        throw new Error("Cannot read the current chain timestamp before creating the election");
    }
    const now = Number(latestBlock.timestamp);
    const startTime = now - 60; // Started 1 minute ago
    const endTime = now + 3600; // Ends in 1 hour

    const registryContract = new ethers.Contract(registryAddress, registryArtifact.abi, deployer);
    const tx = await registryContract.createElection(root, candidateCount, startTime, endTime);
    const receipt = await tx.wait();
    console.log(`  Election created in tx: ${receipt.hash}`);

    // Get election ID from event
    const electionId = 0; // First election
    const actualElection = await registryContract.getElection(electionId);
    if (
        String(actualElection.root).toLowerCase() !== root.toLowerCase() ||
        Number(actualElection.candidateCount) !== candidateCount
    ) {
        throw new Error("Deployed public election does not match the requested root/candidate configuration");
    }
    console.log(`  Election ID: ${electionId}`);
    console.log(`  Candidate count: ${candidateCount}`);
    console.log(`  Voting window: ${new Date(startTime * 1000).toISOString()} - ${new Date(endTime * 1000).toISOString()}`);

    // Save deployed addresses
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }

    const deployedData: DeployedAddresses = {
        network: network.name,
        chainId: Number(network.chainId),
        electionRegistry: registryAddress,
        verifier: verifierAddress,
        ballotBox: ballotBoxAddress,
        electionId,
        candidateCount,
        treeDepth: rootData.depth,
        voterCount: rootData.voterCount,
        seedCommitment: rootData.seedCommitment,
        workflowMode: "PUBLIC_DISCLOSURE",
        selectedVerifier: provisionedVerifier ? {
            ...provisionedVerifier,
            deployment_role: "PUBLIC_VERIFIER",
            deployed_address: verifierAddress,
        } : null,
        deployedAt: new Date().toISOString(),
    };

    const deployedPath = join(DATA_DIR, "deployed.json");
    writeFileSync(deployedPath, JSON.stringify(deployedData, null, 2));
    console.log(`\nSaved deployment data to: ${deployedPath}`);

    console.log("\n=== Deployment complete ===");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
