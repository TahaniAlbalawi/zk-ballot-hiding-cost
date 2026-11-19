/**
 * Reveal retained openings on-chain for a COMMITMENT_REVEAL election, and
 * optionally finalize it after the reveal deadline (FINALIZE=1).
 *
 * The election window is evaluated by the chain clock.  On the local Hardhat
 * chain only, ADVANCE_LOCAL_CHAIN_TIME=1 moves the clock past the scheduled end
 * (and past the reveal deadline when finalizing) instead of waiting.
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { RetainedOpening } from "./lib/openingReconciliation.js";
import { finalizeRevealedElection, revealRetainedOpenings } from "./lib/onchainReveal.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.CMC_RUN_DATA_DIR ?? path.join(__dirname, "../data");
const CONTRACTS_DIR = path.join(__dirname, "../../contracts");
const LOCAL_CHAIN_ID = 31337n;

interface DeployedAddresses {
    ballotBox: string;
    electionRegistry: string;
    electionId: number;
    electionType: string;
}

function loadArtifact(name: string): any {
    const artifactPath = path.join(CONTRACTS_DIR, `artifacts/contracts/${name}.sol/${name}.json`);
    return JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
}

function readBatchSize(): number {
    const value = Number.parseInt(process.env.REVEAL_BATCH_SIZE ?? "32", 10);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("REVEAL_BATCH_SIZE must be a positive integer");
    }
    return value;
}

async function ensureChainTimeAfter(provider: ethers.JsonRpcProvider, boundary: number, label: string): Promise<void> {
    const latest = await provider.getBlock("latest");
    if (!latest) throw new Error("Cannot read the current chain timestamp");
    if (Number(latest.timestamp) > boundary) return;
    const network = await provider.getNetwork();
    if (process.env.ADVANCE_LOCAL_CHAIN_TIME !== "1" || network.chainId !== LOCAL_CHAIN_ID) {
        throw new Error(`Chain time ${latest.timestamp} has not passed the ${label} (${boundary})`);
    }
    await provider.send("evm_increaseTime", [boundary - Number(latest.timestamp) + 1]);
    await provider.send("evm_mine", []);
}

async function main() {
    const deployed: DeployedAddresses = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "deployed.json"), "utf-8"));
    if (deployed.electionType !== "COMMITMENT_REVEAL") {
        throw new Error("This command reveals openings for COMMITMENT_REVEAL elections only");
    }
    const auditPath = path.join(DATA_DIR, `private_votes_${deployed.electionId}.json`);
    if (!fs.existsSync(auditPath)) {
        throw new Error("Retained opening file is missing; nothing can be revealed");
    }
    const openingFile = JSON.parse(fs.readFileSync(auditPath, "utf-8"));
    if (openingFile.schemaVersion !== "RETAINED-OPENINGS-v3" || !Array.isArray(openingFile.openings)) {
        throw new Error("Opening file does not satisfy the RETAINED-OPENINGS-v3 contract");
    }
    const openings: RetainedOpening[] = openingFile.openings;

    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const signer = await provider.getSigner();
    const ballotBox = new ethers.Contract(deployed.ballotBox, loadArtifact("BallotBox").abi, signer);
    const registry = new ethers.Contract(deployed.electionRegistry, loadArtifact("ElectionRegistry").abi, provider);
    const election = await registry.getElectionFull(deployed.electionId);
    if (Number(election.electionType) !== 2) {
        throw new Error("On-chain election is not a COMMITMENT_REVEAL election");
    }

    await ensureChainTimeAfter(provider, Number(election.endTime), "scheduled end of voting");
    const startedAt = Date.now();
    const result = await revealRetainedOpenings(ballotBox, deployed.electionId, openings, readBatchSize());
    const revealMs = Date.now() - startedAt;
    console.log(`Revealed ${result.revealedByThisRun} opening(s) in ${result.batches.length} batch(es); ` +
        `revealed ${result.revealedTotal} of ${result.acceptedCommitments} accepted commitments`);
    if (result.unmatchedOpenings.length > 0) {
        console.log(`Openings without an accepted commitment: ${result.unmatchedOpenings.length}`);
    }

    let finalization = null;
    if (process.env.FINALIZE === "1") {
        await ensureChainTimeAfter(provider, Number(election.revealEndTime), "reveal deadline");
        finalization = await finalizeRevealedElection(ballotBox, deployed.electionId);
        console.log(`Finalized: counts=[${finalization.counts.join(", ")}], unrevealed=${finalization.unrevealed}`);
    }

    const evidencePath = path.join(DATA_DIR, `onchain_reveal_${deployed.electionId}.json`);
    fs.writeFileSync(evidencePath, JSON.stringify({ ...result, revealMs, finalization }, null, 2));
    console.log(`Saved reveal evidence to: ${evidencePath}`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
