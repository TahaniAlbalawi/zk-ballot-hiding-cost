import { getAddress, ZeroHash } from "ethers";
import {
    assertPublishableReconciliation,
    OpeningReconciliationResult,
} from "./openingReconciliation.js";

export const POST_SECRET_RELEASE = 2 as const;

export interface TallyEvidenceV1 {
    snapshotBlockNumber: number;
    snapshotBlockHash: string;
    acceptedCommitmentManifestHash: string;
    openingManifestHash: string;
    acceptedCommitments: number;
    availableOpenings: number;
    validOpenings: number;
    includedOpenings: number;
    missingOpenings: number;
    invalidOpenings: number;
    extraOpenings: number;
    evidenceWindow: typeof POST_SECRET_RELEASE;
    claimedDigest: string;
}

export interface TallySubmissionResult {
    evidence: TallyEvidenceV1;
    evidenceHash: string;
    transactionHash: string;
    blockNumber: number;
    publicationVersion: number;
    tallyStatus: number;
}

export interface PreparedTallyPublication {
    schemaVersion: "PREPARED-TALLY-PUBLICATION-v1";
    action: "SUBMIT" | "CORRECT";
    electionId: string;
    publisher: string;
    publicationVersion: number;
    counts: number[];
    evidence: TallyEvidenceV1;
    evidenceHash: string;
}

export interface TallyPublicationHooks {
    /** Must durably persist the canonical package before broadcast. */
    onPrepared(prepared: PreparedTallyPublication): void | Promise<void>;
    /** Updates the prepared record after a verified successful receipt. */
    onReceipt?(result: TallySubmissionResult): void | Promise<void>;
}

/**
 * Convert a complete, post-release reconciliation into the contract's exact
 * TallyEvidenceV1 tuple. Duplicate openings are an off-chain non-publishable
 * condition and therefore cannot be hidden inside another contract field.
 */
export function tallyEvidenceFromReconciliation(
    reconciliation: OpeningReconciliationResult
): TallyEvidenceV1 {
    assertPublishableReconciliation(reconciliation);
    if (reconciliation.evidenceWindow !== "POST_SECRET_RELEASE") {
        throw new Error("Commitment tally publication requires a POST_SECRET_RELEASE evidence cell");
    }
    if (reconciliation.denominators.duplicateOpenings !== 0) {
        throw new Error("Duplicate openings cannot be represented as publishable tally evidence");
    }

    const denominator = reconciliation.denominators;
    return {
        snapshotBlockNumber: reconciliation.snapshot.blockNumber,
        snapshotBlockHash: reconciliation.snapshot.blockHash,
        acceptedCommitmentManifestHash: reconciliation.acceptedManifestHash,
        openingManifestHash: reconciliation.openingManifestHash,
        acceptedCommitments: denominator.acceptedCommitments,
        availableOpenings: denominator.availableOpenings,
        validOpenings: denominator.validOpenings,
        includedOpenings: denominator.includedOpenings,
        missingOpenings: denominator.missingOpenings,
        invalidOpenings: denominator.invalidOpenings,
        extraOpenings: denominator.extraUnboundOpenings,
        evidenceWindow: POST_SECRET_RELEASE,
        claimedDigest: ZeroHash,
    };
}

/**
 * Ask the contract to recompute the canonical digest, bind that digest into
 * the submitted tuple, and verify the resulting public lifecycle state.
 */
async function publishReconciledTally(
    ballotBox: any,
    electionId: string | number | bigint,
    reconciliation: OpeningReconciliationResult,
    publisher: string,
    publicationVersion: number,
    action: "SUBMIT" | "CORRECT",
    hooks: TallyPublicationHooks
): Promise<TallySubmissionResult> {
    const contractAddress = getAddress(await ballotBox.getAddress()).toLowerCase();
    if (contractAddress !== reconciliation.snapshot.ballotBoxAddress.toLowerCase()) {
        throw new Error("Reconciliation snapshot is bound to a different BallotBox contract");
    }
    const draft = tallyEvidenceFromReconciliation(reconciliation);
    const evidenceHash = await ballotBox.computeTallyEvidenceHash(
        electionId,
        reconciliation.counts,
        draft,
        publisher,
        publicationVersion
    );
    if (String(evidenceHash).toLowerCase() === ZeroHash) {
        throw new Error("Contract returned an empty tally-evidence digest");
    }
    const evidence: TallyEvidenceV1 = {
        ...draft,
        claimedDigest: String(evidenceHash),
    };
    await hooks.onPrepared({
        schemaVersion: "PREPARED-TALLY-PUBLICATION-v1",
        action,
        electionId: BigInt(electionId).toString(),
        publisher: getAddress(publisher),
        publicationVersion,
        counts: [...reconciliation.counts],
        evidence,
        evidenceHash: String(evidenceHash),
    });
    const transaction = action === "SUBMIT"
        ? await ballotBox.submitTally(electionId, reconciliation.counts, evidence)
        : await ballotBox.correctTally(electionId, reconciliation.counts, evidence);
    const receipt = await transaction.wait();
    if (!receipt || Number(receipt.status) !== 1) {
        throw new Error("Tally publication did not produce a successful receipt");
    }

    const storedHash = String(await ballotBox.tallyEvidenceHash(electionId));
    const storedVersion = Number(await ballotBox.tallyPublicationVersion(electionId));
    const storedStatus = Number(await ballotBox.tallyStatus(electionId));
    const storedPublisher = getAddress(await ballotBox.tallyPublisher(electionId)).toLowerCase();
    if (
        storedHash.toLowerCase() !== String(evidenceHash).toLowerCase() ||
        storedVersion !== publicationVersion ||
        storedStatus !== 1 ||
        storedPublisher !== getAddress(publisher).toLowerCase()
    ) {
        throw new Error("Published tally lifecycle/evidence read-back does not match the submission");
    }

    const result = {
        evidence,
        evidenceHash: String(evidenceHash),
        transactionHash: receipt.hash,
        blockNumber: Number(receipt.blockNumber),
        publicationVersion: storedVersion,
        tallyStatus: storedStatus,
    };
    await hooks.onReceipt?.(result);
    return result;
}

export async function submitReconciledTally(
    ballotBox: any,
    electionId: string | number | bigint,
    reconciliation: OpeningReconciliationResult,
    publisher: string,
    publicationVersion: number,
    hooks: TallyPublicationHooks
): Promise<TallySubmissionResult> {
    if (publicationVersion !== 1) {
        throw new Error("Initial tally publication must use publicationVersion=1");
    }
    return publishReconciledTally(
        ballotBox,
        electionId,
        reconciliation,
        publisher,
        publicationVersion,
        "SUBMIT",
        hooks
    );
}

export async function correctReconciledTally(
    ballotBox: any,
    electionId: string | number | bigint,
    reconciliation: OpeningReconciliationResult,
    publisher: string,
    publicationVersion: number,
    hooks: TallyPublicationHooks
): Promise<TallySubmissionResult> {
    if (!Number.isSafeInteger(publicationVersion) || publicationVersion < 2) {
        throw new Error("Tally correction must increment the prior publication version");
    }
    return publishReconciledTally(
        ballotBox,
        electionId,
        reconciliation,
        publisher,
        publicationVersion,
        "CORRECT",
        hooks
    );
}
