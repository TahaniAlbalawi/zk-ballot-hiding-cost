/**
 * Commitment-mode tally publication from a complete, event-bound opening
 * package. The historical filename is retained for compatibility; no
 * decryption occurs because ballots are Poseidon commitments.
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
    canonicalManifestHash,
    captureAcceptedCommitmentSnapshot,
    reconcileOpenings,
    assertPublishableReconciliation,
    RetainedOpening,
} from "./lib/openingReconciliation.js";
import {
    correctReconciledTally,
    submitReconciledTally,
} from "./lib/tallySubmission.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.CMC_RUN_DATA_DIR ?? path.join(__dirname, "../data");
const CONTRACTS_DIR = path.join(__dirname, "../../contracts");
const EVAL_OUTPUT_DIR = path.join(__dirname, "../../evaluation/outputs/tally_time");

interface DeployedAddresses {
    ballotBox: string;
    electionRegistry: string;
    electionId: number;
    candidateCount: number;
    electionType: string;
    resultPublisher: string;
}

interface OpeningFile {
    schemaVersion: "RETAINED-OPENINGS-v3";
    electionId: string;
    capturePartition: "PRIVILEGED_LOCAL";
    captureWindow: "PRE_SECRET_RELEASE";
    releaseState: "NOT_RELEASED";
    openings: RetainedOpening[];
    plannedBallots?: number;
    submittedAttempts?: number;
}

function optionalDenominator(name: string, fallback?: number): number | null {
    const raw = process.env[name];
    if (raw === undefined && fallback === undefined) return null;
    const parsed = Number.parseInt(raw ?? String(fallback), 10);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative integer`);
    }
    return parsed;
}

function loadArtifact(name: string): any {
    const artifactPath = path.join(
        CONTRACTS_DIR,
        `artifacts/contracts/${name}.sol/${name}.json`
    );
    if (!fs.existsSync(artifactPath)) {
        throw new Error(`Missing compiled artifact: ${artifactPath}`);
    }
    return JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
}

function writeJsonAtomically(filePath: string, value: unknown, replace: boolean): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!replace && fs.existsSync(filePath)) {
        throw new Error(`Refusing to overwrite immutable evidence package: ${filePath}`);
    }
    const temporaryPath = `${filePath}.pending-${process.pid}`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
}

async function main() {
    const correctionRequested = process.argv.slice(2).includes("--correct");
    const electionIdArg = process.env.ELECTION_ID;
    const startBlock = Number.parseInt(process.env.START_BLOCK ?? "0", 10);
    const throughBlock = process.env.END_BLOCK && process.env.END_BLOCK !== "latest"
        ? Number.parseInt(process.env.END_BLOCK, 10)
        : undefined;
    if (!Number.isSafeInteger(startBlock) || startBlock < 0) {
        throw new Error("START_BLOCK must be a non-negative integer");
    }
    if (throughBlock !== undefined && (!Number.isSafeInteger(throughBlock) || throughBlock < 0)) {
        throw new Error("END_BLOCK must be 'latest' or a non-negative integer");
    }

    console.log("=== Commitment-Mode Reconciled Tally ===\n");
    const deployedPath = path.join(DATA_DIR, "deployed.json");
    if (!fs.existsSync(deployedPath)) {
        throw new Error("deployed.json not found. Run deploy-private first.");
    }
    const deployed: DeployedAddresses = JSON.parse(fs.readFileSync(deployedPath, "utf-8"));
    const electionId = electionIdArg ? Number.parseInt(electionIdArg, 10) : deployed.electionId;
    if (!Number.isSafeInteger(electionId) || electionId < 0) {
        throw new Error("ELECTION_ID must be a non-negative integer");
    }
    if (deployed.electionType !== "PRIVATE_ENCRYPTED") {
        throw new Error("This command publishes commitment-mode results only; public-mode publication is not applicable");
    }

    const auditPath = path.join(DATA_DIR, `private_votes_${electionId}.json`);
    if (!fs.existsSync(auditPath)) {
        throw new Error("Retained opening file is missing; missing openings are not a zero tally");
    }
    const openingFile: OpeningFile = JSON.parse(fs.readFileSync(auditPath, "utf-8"));
    if (
        openingFile.schemaVersion !== "RETAINED-OPENINGS-v3" ||
        openingFile.electionId !== String(electionId) ||
        openingFile.capturePartition !== "PRIVILEGED_LOCAL" ||
        openingFile.captureWindow !== "PRE_SECRET_RELEASE" ||
        !Array.isArray(openingFile.openings)
    ) {
        throw new Error("Opening file does not satisfy the versioned privileged-local capture contract");
    }

    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const signer = await provider.getSigner();
    const ballotBox = new ethers.Contract(deployed.ballotBox, loadArtifact("BallotBox").abi, signer);
    const registry = new ethers.Contract(deployed.electionRegistry, loadArtifact("ElectionRegistry").abi, provider);
    const election = await registry.getElectionFull(electionId);
    if (Number(election.electionType) !== 1) {
        throw new Error("On-chain election is not a commitment-mode election");
    }
    if (Number(election.candidateCount) !== deployed.candidateCount) {
        throw new Error("On-chain election configuration differs from deployed.json");
    }
    const currentStatus = Number(await ballotBox.tallyStatus(electionId));
    const currentVersion = Number(await ballotBox.tallyPublicationVersion(electionId));
    if (correctionRequested && currentStatus !== 1) {
        throw new Error("--correct requires an existing PUBLISHED tally");
    }
    if (!correctionRequested && currentStatus !== 0) {
        throw new Error("Initial publication requires an UNPUBLISHED election; use --correct only before finalization");
    }
    const targetPublicationVersion = correctionRequested ? currentVersion + 1 : 1;

    const eventScanStartedAt = Date.now();
    const acceptedSnapshot = await captureAcceptedCommitmentSnapshot(
        provider,
        ballotBox,
        electionId,
        startBlock,
        throughBlock
    );
    const eventScanMs = Date.now() - eventScanStartedAt;
    const snapshotBlock = await provider.getBlock(acceptedSnapshot.snapshot.blockNumber);
    if (!snapshotBlock || Number(snapshotBlock.timestamp) <= Number(election.endTime)) {
        throw new Error("The local opening release and tally must occur after the scheduled election end");
    }
    if (process.env.ALLOW_LOCAL_SECRET_RELEASE !== "1") {
        throw new Error("Set ALLOW_LOCAL_SECRET_RELEASE=1 to record the explicit privileged-local post-release transition");
    }

    const plannedBallots = optionalDenominator("PLANNED_BALLOTS", openingFile.plannedBallots);
    const submittedAttempts = optionalDenominator("SUBMITTED_ATTEMPTS", openingFile.submittedAttempts);
    const chainAcceptedCount = Number(await ballotBox.encryptedBallotCount(electionId));
    const chainTotalVotes = Number(await ballotBox.totalVotes(electionId));
    if (
        chainAcceptedCount !== acceptedSnapshot.accepted.length ||
        chainTotalVotes !== acceptedSnapshot.accepted.length
    ) {
        throw new Error("Accepted-event ledger does not reconcile with the contract's accepted commitment count");
    }

    const releaseRecord = {
        schemaVersion: "OPENING-RELEASE-v1",
        state: "RELEASED_TO_TALLY_PROCESS",
        electionId: String(electionId),
        evidencePartition: "PRIVILEGED_LOCAL",
        evidenceWindow: "POST_SECRET_RELEASE",
        releasedAt: new Date().toISOString(),
        scheduledEndTime: Number(election.endTime),
        snapshot: acceptedSnapshot.snapshot,
        openingCaptureHash: canonicalManifestHash("OPENING-CAPTURE-v1", openingFile),
    } as const;
    const releasePath = path.join(
        DATA_DIR,
        `private_opening_release_${electionId}_v${targetPublicationVersion}.json`
    );
    fs.writeFileSync(releasePath, JSON.stringify({
        ...releaseRecord,
        releaseManifestHash: canonicalManifestHash("OPENING-RELEASE-v1", releaseRecord),
    }, null, 2), { flag: "wx" });

    const reconciliationStartedAt = Date.now();
    const reconciliation = await reconcileOpenings({
        acceptedSnapshot,
        openings: openingFile.openings,
        candidateCount: deployed.candidateCount,
        plannedBallots,
        submittedAttempts,
        evidencePartition: "PRIVILEGED_LOCAL",
        evidenceWindow: "POST_SECRET_RELEASE",
    });
    const reconciliationMs = Date.now() - reconciliationStartedAt;
    assertPublishableReconciliation(reconciliation);

    const publisher = await signer.getAddress();
    const configuredPublisher = await registry.getResultPublisher(electionId);
    if (String(configuredPublisher).toLowerCase() !== publisher.toLowerCase()) {
        throw new Error("Connected signer is not the configured result publisher");
    }

    const evidencePackagePath = path.join(
        EVAL_OUTPUT_DIR,
        `tally_evidence_${electionId}_v${targetPublicationVersion}.json`
    );
    const evidencePackageBase = {
        schemaVersion: "CANONICAL-TALLY-EVIDENCE-PACKAGE-v1",
        electionId: String(electionId),
        publicationAction: correctionRequested ? "CORRECT" : "SUBMIT",
        publicationVersion: targetPublicationVersion,
        candidateCount: deployed.candidateCount,
        snapshot: reconciliation.snapshot,
        denominators: reconciliation.denominators,
        acceptedManifestHash: reconciliation.acceptedManifestHash,
        openingManifestHash: reconciliation.openingManifestHash,
        evidencePartition: reconciliation.evidencePartition,
        evidenceWindow: reconciliation.evidenceWindow,
        releasePath,
    } as const;

    const publicationStartedAt = Date.now();
    const persistenceHooks = {
        onPrepared: (prepared: unknown) => writeJsonAtomically(evidencePackagePath, {
            ...evidencePackageBase,
            state: "PREPARED",
            preparedAt: new Date().toISOString(),
            prepared,
        }, false),
        onReceipt: (receiptEvidence: unknown) => {
            const preparedPackage = JSON.parse(fs.readFileSync(evidencePackagePath, "utf-8"));
            writeJsonAtomically(evidencePackagePath, {
                ...preparedPackage,
                state: "PUBLISHED",
                receiptRecordedAt: new Date().toISOString(),
                receiptEvidence,
            }, true);
        },
    };
    const publication = correctionRequested
        ? await correctReconciledTally(
            ballotBox,
            electionId,
            reconciliation,
            publisher,
            targetPublicationVersion,
            persistenceHooks
        )
        : await submitReconciledTally(
            ballotBox,
            electionId,
            reconciliation,
            publisher,
            targetPublicationVersion,
            persistenceHooks
        );
    const publicationMs = Date.now() - publicationStartedAt;

    const result = {
        schemaVersion: "RECONCILED-TALLY-RESULT-v1",
        electionId,
        candidateCount: deployed.candidateCount,
        counts: reconciliation.counts,
        denominators: reconciliation.denominators,
        snapshot: reconciliation.snapshot,
        acceptedManifestHash: reconciliation.acceptedManifestHash,
        openingManifestHash: reconciliation.openingManifestHash,
        evidencePartition: reconciliation.evidencePartition,
        evidenceWindow: reconciliation.evidenceWindow,
        releasePath,
        eventScanMs,
        reconciliationMs,
        publicationMs,
        publication,
        publicationAction: correctionRequested ? "CORRECT" : "SUBMIT",
        canonicalEvidencePackagePath: evidencePackagePath,
        generatedAt: new Date().toISOString(),
    };

    fs.mkdirSync(EVAL_OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(
        EVAL_OUTPUT_DIR,
        `tally_result_${electionId}_v${targetPublicationVersion}.json`
    );
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), { flag: "wx" });

    console.log("\n=== Published Result ===");
    reconciliation.counts.forEach((count, candidate) => {
        console.log(`Candidate ${candidate}: ${count} votes`);
    });
    console.log(`Denominators: ${JSON.stringify(reconciliation.denominators)}`);
    console.log(`Evidence digest: ${publication.evidenceHash}`);
    console.log(`Canonical evidence package: ${evidencePackagePath}`);
    console.log(`Result evidence saved to: ${outputPath}`);
    return result;
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
