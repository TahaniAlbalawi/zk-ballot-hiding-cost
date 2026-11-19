/**
 * On-chain reveal for COMMITMENT_REVEAL elections.  Each retained opening is
 * submitted to BallotBox.revealVotes, which recomputes Poseidon(vote, randomness)
 * against the stored commitment; the result is the contract's revealed counts,
 * so any observer can re-derive it from chain state and VoteRevealed events.
 */
import type { RetainedOpening } from "./openingReconciliation.js";

export const ONCHAIN_REVEAL_SCHEMA_VERSION = "ONCHAIN-REVEAL-v1" as const;

export interface RevealBatchRecord {
    ballotIndices: number[];
    transactionHash: string;
    blockNumber: number;
    gasUsed: string;
}

export interface OnchainRevealResult {
    schemaVersion: typeof ONCHAIN_REVEAL_SCHEMA_VERSION;
    electionId: string;
    acceptedCommitments: number;
    revealedBefore: number;
    revealedByThisRun: number;
    alreadyRevealedOpenings: string[];
    /** Openings whose commitment is not among the accepted on-chain commitments. */
    unmatchedOpenings: string[];
    batches: RevealBatchRecord[];
    counts: string[];
    revealedTotal: number;
    unrevealed: number;
}

export interface RevealFinalization {
    transactionHash: string;
    blockNumber: number;
    gasUsed: string;
    counts: string[];
    revealed: number;
    unrevealed: number;
}

function positiveInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
    return value;
}

/**
 * Reveal every retained opening that matches an accepted, not-yet-revealed
 * commitment, in batches of at most batchSize ballots per transaction.
 */
export async function revealRetainedOpenings(
    ballotBox: any,
    electionIdInput: string | number | bigint,
    openings: readonly RetainedOpening[],
    batchSize: number
): Promise<OnchainRevealResult> {
    const electionId = BigInt(electionIdInput);
    positiveInteger(batchSize, "batchSize");

    const acceptedCommitments = Number(await ballotBox.encryptedBallotCount(electionId));
    const indexByCommitment = new Map<string, number>();
    for (let index = 0; index < acceptedCommitments; index++) {
        const commitment = (await ballotBox.encryptedBallots(electionId, index)).toString();
        if (indexByCommitment.has(commitment)) {
            throw new Error(`Accepted commitments are not unique (index ${index})`);
        }
        indexByCommitment.set(commitment, index);
    }

    const revealedBefore = Number(await ballotBox.revealedTotal(electionId));
    const pending: Array<{ ballotIndex: number; vote: bigint; randomness: bigint }> = [];
    const unmatchedOpenings: string[] = [];
    const alreadyRevealedOpenings: string[] = [];
    const scheduled = new Set<number>();
    for (const opening of openings) {
        if (BigInt(opening.electionId) !== electionId) {
            throw new Error(`Opening ${opening.openingId} belongs to another election`);
        }
        const ballotIndex = indexByCommitment.get(BigInt(opening.commitment).toString());
        if (ballotIndex === undefined) {
            unmatchedOpenings.push(opening.openingId);
            continue;
        }
        if (scheduled.has(ballotIndex) || await ballotBox.isBallotRevealed(electionId, ballotIndex)) {
            alreadyRevealedOpenings.push(opening.openingId);
            continue;
        }
        scheduled.add(ballotIndex);
        pending.push({ ballotIndex, vote: BigInt(opening.vote), randomness: BigInt(opening.randomness) });
    }
    pending.sort((left, right) => left.ballotIndex - right.ballotIndex);

    const batches: RevealBatchRecord[] = [];
    for (let start = 0; start < pending.length; start += batchSize) {
        const batch = pending.slice(start, start + batchSize);
        const tx = await ballotBox.revealVotes(
            electionId,
            batch.map((item) => item.ballotIndex),
            batch.map((item) => item.vote),
            batch.map((item) => item.randomness)
        );
        const receipt = await tx.wait();
        if (!receipt || Number(receipt.status) !== 1) {
            throw new Error(`Reveal batch starting at ballot ${batch[0].ballotIndex} did not succeed`);
        }
        batches.push({
            ballotIndices: batch.map((item) => item.ballotIndex),
            transactionHash: receipt.hash,
            blockNumber: Number(receipt.blockNumber),
            gasUsed: receipt.gasUsed.toString(),
        });
    }

    const revealedTotal = Number(await ballotBox.revealedTotal(electionId));
    const counts: bigint[] = await ballotBox.getResults(electionId);
    return {
        schemaVersion: ONCHAIN_REVEAL_SCHEMA_VERSION,
        electionId: electionId.toString(),
        acceptedCommitments,
        revealedBefore,
        revealedByThisRun: pending.length,
        alreadyRevealedOpenings,
        unmatchedOpenings,
        batches,
        counts: counts.map((count) => count.toString()),
        revealedTotal,
        unrevealed: acceptedCommitments - revealedTotal,
    };
}

/** Finalize after the reveal deadline and return the emitted result. */
export async function finalizeRevealedElection(
    ballotBox: any,
    electionIdInput: string | number | bigint
): Promise<RevealFinalization> {
    const electionId = BigInt(electionIdInput);
    const tx = await ballotBox.finalizeReveal(electionId);
    const receipt = await tx.wait();
    if (!receipt || Number(receipt.status) !== 1) {
        throw new Error("finalizeReveal did not succeed");
    }
    for (const log of receipt.logs ?? []) {
        let parsed: any;
        try {
            parsed = ballotBox.interface.parseLog(log);
        } catch {
            continue;
        }
        if (parsed?.name !== "RevealFinalized") continue;
        return {
            transactionHash: receipt.hash,
            blockNumber: Number(receipt.blockNumber),
            gasUsed: receipt.gasUsed.toString(),
            counts: (parsed.args.counts as bigint[]).map((count) => count.toString()),
            revealed: Number(parsed.args.revealed),
            unrevealed: Number(parsed.args.unrevealed),
        };
    }
    throw new Error("finalizeReveal receipt carries no RevealFinalized event");
}
