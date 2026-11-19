/**
 * Deterministic, election-grain reconciliation of accepted commitment events
 * against retained private openings.  This module is deliberately free of
 * filesystem and CLI globals so that Node CLI, evaluation, and Next server
 * routes can share one semantic implementation.
 */
import { getAddress, keccak256, toUtf8Bytes } from "ethers";
import { buildPoseidon } from "circomlibjs";

export const RECONCILIATION_SCHEMA_VERSION = "OPENING-RECONCILIATION-v2" as const;
export const ACCEPTED_MANIFEST_DOMAIN = "ACCEPTED-COMMITMENT-MANIFEST-v1" as const;
export const OPENING_MANIFEST_DOMAIN = "OPENING-MANIFEST-v2" as const;

export type EvidencePartition = "PUBLIC" | "PRIVILEGED_LOCAL" | "PROCEDURAL" | "NONE";
export type EvidenceWindow = "PRE_SECRET_RELEASE" | "POST_SECRET_RELEASE";

export interface FrozenCommitmentSnapshot {
    schemaVersion: "ACCEPTED-COMMITMENT-SNAPSHOT-v1";
    chainId: string;
    ballotBoxAddress: string;
    electionId: string;
    fromBlock: number;
    blockNumber: number;
    blockHash: string;
}

export interface AcceptedCommitment {
    electionId: string;
    nullifier: string;
    commitment: string;
    voter: string;
    receiptHash: string;
    transactionHash: string;
    blockNumber: number;
    blockHash: string;
    transactionIndex: number;
    logIndex: number;
}

export interface AcceptedCommitmentSnapshot {
    snapshot: FrozenCommitmentSnapshot;
    accepted: AcceptedCommitment[];
    acceptedManifestHash: string;
}

export interface AcceptedEventBinding {
    transactionHash: string;
    blockNumber: number;
    blockHash: string;
    transactionIndex: number;
    logIndex: number;
    receiptHash: string;
}

export interface RetainedOpening {
    openingId: string;
    electionId: string | number | bigint;
    nullifier: string | number | bigint;
    commitment: string | number | bigint;
    vote: string | number | bigint;
    randomness: string | number | bigint;
    acceptedEvent: AcceptedEventBinding;
    /** Immutable provenance of the original capture. */
    capturePartition: EvidencePartition;
    captureWindow: EvidenceWindow;
    /** Explicit export/release binding required before local material is a PUBLIC observation. */
    release?: {
        schemaVersion: "OPENING-RELEASE-v1";
        state: "RELEASED";
        releasedAt: string;
        evidenceWindow: "POST_SECRET_RELEASE";
        exportManifestHash: string;
    };
}

export type ReconciliationIssueClass = "INVALID" | "DUPLICATE" | "EXTRA_UNBOUND";

export interface ReconciliationIssue {
    openingId: string;
    issueClass: ReconciliationIssueClass;
    code: string;
    detail: string;
}

export interface ReconciledOpening {
    opening: RetainedOpening;
    accepted: AcceptedCommitment;
}

export interface ReconciliationDenominators {
    plannedBallots: number | null;
    submittedAttempts: number | null;
    acceptedCommitments: number;
    availableOpenings: number;
    validOpenings: number;
    includedOpenings: number;
    missingOpenings: number;
    invalidOpenings: number;
    duplicateOpenings: number;
    extraUnboundOpenings: number;
    resultVectorSum: number;
}

export interface OpeningReconciliationResult {
    schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
    snapshot: FrozenCommitmentSnapshot;
    acceptedManifestHash: string;
    openingManifestHash: string;
    evidencePartition: EvidencePartition;
    evidenceWindow: EvidenceWindow;
    candidateCount: number;
    counts: number[];
    denominators: ReconciliationDenominators;
    included: ReconciledOpening[];
    missingAccepted: AcceptedCommitment[];
    issues: ReconciliationIssue[];
    publishable: boolean;
}

export interface ReconcileOpeningsInput {
    acceptedSnapshot: AcceptedCommitmentSnapshot;
    openings: readonly RetainedOpening[];
    candidateCount: number;
    plannedBallots?: number | null;
    submittedAttempts?: number | null;
    evidencePartition: EvidencePartition;
    evidenceWindow: EvidenceWindow;
    commitmentFunction?: (
        vote: bigint,
        randomness: bigint
    ) => Promise<bigint>;
}

export class ReconciliationNotPublishableError extends Error {
    readonly code = "RECONCILIATION_NOT_PUBLISHABLE";
    readonly reconciliation: OpeningReconciliationResult;

    constructor(reconciliation: OpeningReconciliationResult) {
        super(
            `Opening reconciliation is incomplete: ${JSON.stringify(reconciliation.denominators)}`
        );
        this.name = "ReconciliationNotPublishableError";
        this.reconciliation = reconciliation;
    }
}

function integerString(value: string | number | bigint, label: string): string {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
        throw new Error(`${label} must be a safe integer`);
    }
    let parsed: bigint;
    try {
        parsed = BigInt(value);
    } catch {
        throw new Error(`${label} is not an integer`);
    }
    if (parsed < BigInt(0)) {
        throw new Error(`${label} must be non-negative`);
    }
    return parsed.toString(10);
}

function nonNegativeInteger(value: number | null | undefined, label: string): number | null {
    if (value === undefined || value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer or null`);
    }
    return value;
}

function normalizeHash(value: string, label: string): string {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
        throw new Error(`${label} must be a 32-byte hexadecimal value`);
    }
    return value.toLowerCase();
}

function normalizeAddress(value: string, label: string): string {
    try {
        return getAddress(value).toLowerCase();
    } catch {
        throw new Error(`${label} must be a valid address`);
    }
}

function normalizeIndex(value: unknown, label: string): number {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
    return numeric;
}

function compareAccepted(a: AcceptedCommitment, b: AcceptedCommitment): number {
    return a.blockNumber - b.blockNumber ||
        a.transactionIndex - b.transactionIndex ||
        a.logIndex - b.logIndex ||
        a.nullifier.localeCompare(b.nullifier);
}

function compareOpenings(a: RetainedOpening, b: RetainedOpening): number {
    const aEvent = a.acceptedEvent;
    const bEvent = b.acceptedEvent;
    const numberOrMax = (value: unknown) => Number.isSafeInteger(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER;
    return numberOrMax(aEvent?.blockNumber) - numberOrMax(bEvent?.blockNumber) ||
        numberOrMax(aEvent?.transactionIndex) - numberOrMax(bEvent?.transactionIndex) ||
        numberOrMax(aEvent?.logIndex) - numberOrMax(bEvent?.logIndex) ||
        String(a.openingId ?? "").localeCompare(String(b.openingId ?? ""));
}

function canonicalize(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "bigint") return JSON.stringify(value.toString(10));
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(",")}]`;
    }
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
            .join(",")}}`;
    }
    throw new Error(`Unsupported canonical value type: ${typeof value}`);
}

export function canonicalManifestHash(domain: string, value: unknown): string {
    return keccak256(toUtf8Bytes(canonicalize({ domain, value })));
}

function acceptedLocator(record: AcceptedCommitment): string {
    return `${record.transactionHash.toLowerCase()}:${record.logIndex}`;
}

function normalizeAccepted(record: AcceptedCommitment): AcceptedCommitment {
    return {
        electionId: integerString(record.electionId, "accepted.electionId"),
        nullifier: integerString(record.nullifier, "accepted.nullifier"),
        commitment: integerString(record.commitment, "accepted.commitment"),
        voter: normalizeAddress(record.voter, "accepted.voter"),
        receiptHash: normalizeHash(record.receiptHash, "accepted.receiptHash"),
        transactionHash: normalizeHash(record.transactionHash, "accepted.transactionHash"),
        blockNumber: normalizeIndex(record.blockNumber, "accepted.blockNumber"),
        blockHash: normalizeHash(record.blockHash, "accepted.blockHash"),
        transactionIndex: normalizeIndex(record.transactionIndex, "accepted.transactionIndex"),
        logIndex: normalizeIndex(record.logIndex, "accepted.logIndex"),
    };
}

/**
 * Freeze and reconstruct the public accepted-commitment ledger at one named
 * block. Query-filtered logs are additionally bound to successful receipts.
 */
export async function captureAcceptedCommitmentSnapshot(
    provider: any,
    ballotBox: any,
    electionIdInput: string | number | bigint,
    fromBlock = 0,
    throughBlock?: number
): Promise<AcceptedCommitmentSnapshot> {
    const electionId = integerString(electionIdInput, "electionId");
    const normalizedFromBlock = normalizeIndex(fromBlock, "fromBlock");
    const blockNumber = normalizeIndex(
        throughBlock ?? await provider.getBlockNumber(),
        "throughBlock"
    );
    if (blockNumber < normalizedFromBlock) {
        throw new Error("Snapshot block cannot precede fromBlock");
    }
    const block = await provider.getBlock(blockNumber);
    if (!block?.hash) {
        throw new Error(`Unable to freeze snapshot block ${blockNumber}`);
    }
    const network = await provider.getNetwork();
    const ballotBoxAddress = normalizeAddress(await ballotBox.getAddress(), "ballotBoxAddress");
    const filter = ballotBox.filters.EncryptedVoteCast(electionId);
    const logs = await ballotBox.queryFilter(filter, normalizedFromBlock, blockNumber);
    const receiptCache = new Map<string, any>();
    const accepted: AcceptedCommitment[] = [];

    for (const log of logs) {
        const args = (log as any).args;
        if (!args) throw new Error("EncryptedVoteCast log is missing decoded arguments");
        const transactionHash = normalizeHash((log as any).transactionHash, "event.transactionHash");
        let receipt = receiptCache.get(transactionHash);
        if (!receipt) {
            receipt = await provider.getTransactionReceipt(transactionHash);
            receiptCache.set(transactionHash, receipt);
        }
        if (!receipt || Number(receipt.status) !== 1) {
            throw new Error(`Accepted event ${transactionHash} lacks a successful receipt`);
        }

        const record = normalizeAccepted({
            electionId: args.electionId ?? args[0],
            nullifier: args.nullifier ?? args[1],
            commitment: args.commitment ?? args[2],
            voter: args.voter ?? args[3],
            receiptHash: args.receiptHash ?? args[4],
            transactionHash,
            blockNumber: (log as any).blockNumber,
            blockHash: (log as any).blockHash,
            transactionIndex: (log as any).transactionIndex ?? receipt.index,
            logIndex: (log as any).index ?? (log as any).logIndex,
        });
        if (record.electionId !== electionId) {
            throw new Error(`Event election ${record.electionId} does not match snapshot election ${electionId}`);
        }
        if (record.blockNumber > blockNumber) {
            throw new Error("Accepted event lies after the frozen snapshot");
        }
        if (record.blockHash !== String(receipt.blockHash).toLowerCase()) {
            throw new Error(`Event/receipt block hash mismatch for ${transactionHash}`);
        }
        accepted.push(record);
    }

    accepted.sort(compareAccepted);
    const nullifiers = new Set<string>();
    const locators = new Set<string>();
    for (const record of accepted) {
        if (nullifiers.has(record.nullifier)) {
            throw new Error(`Accepted event ledger contains duplicate nullifier ${record.nullifier}`);
        }
        const locator = acceptedLocator(record);
        if (locators.has(locator)) {
            throw new Error(`Accepted event ledger contains duplicate locator ${locator}`);
        }
        nullifiers.add(record.nullifier);
        locators.add(locator);
    }

    const snapshot: FrozenCommitmentSnapshot = {
        schemaVersion: "ACCEPTED-COMMITMENT-SNAPSHOT-v1",
        chainId: integerString(network.chainId, "chainId"),
        ballotBoxAddress,
        electionId,
        fromBlock: normalizedFromBlock,
        blockNumber,
        blockHash: normalizeHash(block.hash, "snapshot.blockHash"),
    };

    return {
        snapshot,
        accepted,
        acceptedManifestHash: canonicalManifestHash(ACCEPTED_MANIFEST_DOMAIN, { snapshot, accepted }),
    };
}

/**
 * Build a retained opening only from the unique matching accepted event in a
 * successful transaction receipt. A rejected or event-less transaction cannot
 * create an apparently accepted opening.
 */
export function retainedOpeningFromReceipt(
    ballotBox: any,
    receipt: any,
    values: {
        electionId: string | number | bigint;
        nullifier: string | number | bigint;
        commitment: string | number | bigint;
        vote: string | number | bigint;
        randomness: string | number | bigint;
        capturePartition?: EvidencePartition;
        captureWindow?: EvidenceWindow;
    }
): RetainedOpening {
    if (!receipt || Number(receipt.status) !== 1 || !receipt.hash || !receipt.blockHash) {
        throw new Error("Cannot retain an opening without a successful transaction receipt");
    }

    const expectedElectionId = integerString(values.electionId, "opening.electionId");
    const expectedNullifier = integerString(values.nullifier, "opening.nullifier");
    const expectedCommitment = integerString(values.commitment, "opening.commitment");
    const ballotAddress = String(ballotBox.target ?? "").toLowerCase();
    const matches: Array<{ log: any; parsed: any }> = [];

    for (const log of receipt.logs ?? []) {
        if (ballotAddress && String(log.address).toLowerCase() !== ballotAddress) continue;
        try {
            const parsed = ballotBox.interface.parseLog(log);
            if (parsed?.name !== "EncryptedVoteCast") continue;
            const eventElectionId = integerString(parsed.args.electionId ?? parsed.args[0], "event.electionId");
            const eventNullifier = integerString(parsed.args.nullifier ?? parsed.args[1], "event.nullifier");
            const eventCommitment = integerString(parsed.args.commitment ?? parsed.args[2], "event.commitment");
            if (
                eventElectionId === expectedElectionId &&
                eventNullifier === expectedNullifier &&
                eventCommitment === expectedCommitment
            ) {
                matches.push({ log, parsed });
            }
        } catch {
            // A receipt commonly includes logs from other contracts.
        }
    }
    if (matches.length !== 1) {
        throw new Error(`Expected one matching EncryptedVoteCast event; found ${matches.length}`);
    }

    const { log, parsed } = matches[0];
    const transactionHash = normalizeHash(receipt.hash, "receipt.transactionHash");
    const logIndex = normalizeIndex(log.index ?? log.logIndex, "event.logIndex");
    return {
        openingId: `${transactionHash}:${logIndex}`,
        electionId: expectedElectionId,
        nullifier: expectedNullifier,
        commitment: expectedCommitment,
        vote: integerString(values.vote, "opening.vote"),
        randomness: integerString(values.randomness, "opening.randomness"),
        acceptedEvent: {
            transactionHash,
            blockNumber: normalizeIndex(receipt.blockNumber, "receipt.blockNumber"),
            blockHash: normalizeHash(receipt.blockHash, "receipt.blockHash"),
            transactionIndex: normalizeIndex(receipt.index, "receipt.transactionIndex"),
            logIndex,
            receiptHash: normalizeHash(parsed.args.receiptHash ?? parsed.args[4], "event.receiptHash"),
        },
        capturePartition: values.capturePartition ?? "PRIVILEGED_LOCAL",
        captureWindow: values.captureWindow ?? "PRE_SECRET_RELEASE",
    };
}

// Building the Poseidon instance is expensive; build it once per process rather
// than once per opening.
let poseidonInstance: ReturnType<typeof buildPoseidon> | null = null;

async function defaultCommitmentFunction(vote: bigint, randomness: bigint): Promise<bigint> {
    poseidonInstance ??= buildPoseidon();
    const poseidon = await poseidonInstance;
    return BigInt(poseidon.F.toObject(poseidon([vote, randomness])).toString());
}

function eventBindingMatches(opening: RetainedOpening, accepted: AcceptedCommitment): boolean {
    const event = opening.acceptedEvent;
    return event.transactionHash.toLowerCase() === accepted.transactionHash &&
        event.blockNumber === accepted.blockNumber &&
        event.blockHash.toLowerCase() === accepted.blockHash &&
        event.transactionIndex === accepted.transactionIndex &&
        event.logIndex === accepted.logIndex &&
        event.receiptHash.toLowerCase() === accepted.receiptHash;
}

export async function reconcileOpenings(
    input: ReconcileOpeningsInput
): Promise<OpeningReconciliationResult> {
    const { acceptedSnapshot } = input;
    const electionId = integerString(acceptedSnapshot.snapshot.electionId, "snapshot.electionId");
    const candidateCount = normalizeIndex(input.candidateCount, "candidateCount");
    if (candidateCount === 0) throw new Error("candidateCount must be positive");

    const plannedBallots = nonNegativeInteger(input.plannedBallots, "plannedBallots");
    const submittedAttempts = nonNegativeInteger(input.submittedAttempts, "submittedAttempts");
    const accepted = acceptedSnapshot.accepted.map(normalizeAccepted).sort(compareAccepted);
    const normalizedSnapshot: FrozenCommitmentSnapshot = {
        schemaVersion: "ACCEPTED-COMMITMENT-SNAPSHOT-v1",
        chainId: integerString(acceptedSnapshot.snapshot.chainId, "snapshot.chainId"),
        ballotBoxAddress: normalizeAddress(acceptedSnapshot.snapshot.ballotBoxAddress, "snapshot.ballotBoxAddress"),
        electionId,
        fromBlock: normalizeIndex(acceptedSnapshot.snapshot.fromBlock, "snapshot.fromBlock"),
        blockNumber: normalizeIndex(acceptedSnapshot.snapshot.blockNumber, "snapshot.blockNumber"),
        blockHash: normalizeHash(acceptedSnapshot.snapshot.blockHash, "snapshot.blockHash"),
    };
    const recomputedAcceptedManifestHash = canonicalManifestHash(
        ACCEPTED_MANIFEST_DOMAIN,
        { snapshot: normalizedSnapshot, accepted }
    );
    if (
        recomputedAcceptedManifestHash !==
        normalizeHash(acceptedSnapshot.acceptedManifestHash, "acceptedManifestHash")
    ) {
        throw new Error("Accepted commitment manifest hash does not match the frozen snapshot and ordered event ledger");
    }
    const acceptedNullifiers = new Set<string>();
    const acceptedLocators = new Set<string>();
    for (const record of accepted) {
        if (record.electionId !== electionId) {
            throw new Error(`Accepted record election ${record.electionId} differs from snapshot election ${electionId}`);
        }
        if (record.blockNumber > normalizedSnapshot.blockNumber) {
            throw new Error("Accepted record lies after the frozen snapshot block");
        }
        const locator = acceptedLocator(record);
        if (acceptedNullifiers.has(record.nullifier) || acceptedLocators.has(locator)) {
            throw new Error("Accepted commitment ledger is not unique at election/nullifier/event grain");
        }
        acceptedNullifiers.add(record.nullifier);
        acceptedLocators.add(locator);
    }
    if (submittedAttempts !== null && accepted.length > submittedAttempts) {
        throw new Error("accepted commitments cannot exceed submitted attempts");
    }
    if (plannedBallots !== null && accepted.length > plannedBallots) {
        throw new Error("accepted commitments cannot exceed the frozen planned-ballot denominator");
    }

    const acceptedByNullifier = new Map(accepted.map((record) => [record.nullifier, record]));
    const openings = [...input.openings].sort(compareOpenings);
    const openingManifestHash = canonicalManifestHash(OPENING_MANIFEST_DOMAIN, {
        snapshot: normalizedSnapshot,
        evidencePartition: input.evidencePartition,
        evidenceWindow: input.evidenceWindow,
        openings,
    });
    const issues: ReconciliationIssue[] = [];
    let selfConsistentCount = 0;
    let invalidOpeningCount = 0;
    const groupedByNullifier = new Map<string, RetainedOpening[]>();
    const commitmentFunction = input.commitmentFunction ?? defaultCommitmentFunction;

    for (const opening of openings) {
        const localIssues: ReconciliationIssue[] = [];
        let normalizedElectionId = "";
        let normalizedNullifier = "";
        let normalizedCommitment = "";
        let vote = BigInt(-1);
        let randomness = BigInt(-1);
        try {
            if (!opening.openingId || typeof opening.openingId !== "string") {
                throw new Error("openingId must be a non-empty string");
            }
            normalizedElectionId = integerString(opening.electionId, "opening.electionId");
            normalizedNullifier = integerString(opening.nullifier, "opening.nullifier");
            normalizedCommitment = integerString(opening.commitment, "opening.commitment");
            vote = BigInt(integerString(opening.vote, "opening.vote"));
            randomness = BigInt(integerString(opening.randomness, "opening.randomness"));
            const eventTransactionHash = normalizeHash(opening.acceptedEvent.transactionHash, "opening.acceptedEvent.transactionHash");
            normalizeHash(opening.acceptedEvent.blockHash, "opening.acceptedEvent.blockHash");
            normalizeHash(opening.acceptedEvent.receiptHash, "opening.acceptedEvent.receiptHash");
            normalizeIndex(opening.acceptedEvent.blockNumber, "opening.acceptedEvent.blockNumber");
            normalizeIndex(opening.acceptedEvent.transactionIndex, "opening.acceptedEvent.transactionIndex");
            const eventLogIndex = normalizeIndex(opening.acceptedEvent.logIndex, "opening.acceptedEvent.logIndex");
            if (opening.openingId !== `${eventTransactionHash}:${eventLogIndex}`) {
                localIssues.push({ openingId: opening.openingId, issueClass: "INVALID", code: "OPENING_ID_BINDING_MISMATCH", detail: "openingId does not equal the accepted transaction/log locator" });
            }
            if (normalizedElectionId !== electionId) {
                localIssues.push({ openingId: opening.openingId, issueClass: "INVALID", code: "ELECTION_MISMATCH", detail: "Opening election differs from the frozen snapshot" });
            }
            if (vote >= BigInt(candidateCount)) {
                localIssues.push({ openingId: opening.openingId, issueClass: "INVALID", code: "CANDIDATE_OUT_OF_RANGE", detail: "Opening vote is outside the configured candidate range" });
            }
            if (!(["PUBLIC", "PRIVILEGED_LOCAL", "PROCEDURAL", "NONE"] as readonly string[]).includes(opening.capturePartition)) {
                localIssues.push({ openingId: opening.openingId, issueClass: "INVALID", code: "INVALID_CAPTURE_PARTITION", detail: "Opening capture partition is outside the controlled vocabulary" });
            }
            if (!(["PRE_SECRET_RELEASE", "POST_SECRET_RELEASE"] as readonly string[]).includes(opening.captureWindow)) {
                localIssues.push({ openingId: opening.openingId, issueClass: "INVALID", code: "INVALID_CAPTURE_WINDOW", detail: "Opening capture window is outside the controlled vocabulary" });
            }
            if (opening.capturePartition !== input.evidencePartition) {
                const releasedForPublicUse =
                    input.evidencePartition === "PUBLIC" &&
                    opening.capturePartition === "PRIVILEGED_LOCAL" &&
                    opening.release?.schemaVersion === "OPENING-RELEASE-v1" &&
                    opening.release.state === "RELEASED" &&
                    opening.release.evidenceWindow === "POST_SECRET_RELEASE" &&
                    /^0x[0-9a-fA-F]{64}$/.test(opening.release.exportManifestHash);
                if (!releasedForPublicUse) {
                    localIssues.push({ openingId: opening.openingId, issueClass: "INVALID", code: "EVIDENCE_PARTITION_MISMATCH", detail: "Capture partition cannot support the declared observer partition without an explicit release binding" });
                }
            }
            if (input.evidenceWindow === "PRE_SECRET_RELEASE" && opening.captureWindow !== "PRE_SECRET_RELEASE") {
                localIssues.push({ openingId: opening.openingId, issueClass: "INVALID", code: "EVIDENCE_WINDOW_MISMATCH", detail: "Post-release capture cannot be used as pre-release evidence" });
            }
            const recomputed = await commitmentFunction(vote, randomness);
            if (recomputed.toString(10) !== normalizedCommitment) {
                localIssues.push({ openingId: opening.openingId, issueClass: "INVALID", code: "COMMITMENT_MISMATCH", detail: "Poseidon(vote, randomness) does not equal the retained commitment" });
            }
        } catch (error) {
            localIssues.push({
                openingId: opening.openingId,
                issueClass: "INVALID",
                code: "MALFORMED_OPENING",
                detail: error instanceof Error ? error.message : String(error),
            });
        }

        if (localIssues.length > 0) {
            issues.push(...localIssues);
            invalidOpeningCount++;
            continue;
        }
        selfConsistentCount++;
        const group = groupedByNullifier.get(normalizedNullifier) ?? [];
        group.push(opening);
        groupedByNullifier.set(normalizedNullifier, group);
    }

    const included: ReconciledOpening[] = [];
    for (const [nullifier, group] of groupedByNullifier.entries()) {
        if (group.length > 1) {
            for (const opening of group) {
                issues.push({
                    openingId: opening.openingId,
                    issueClass: "DUPLICATE",
                    code: "DUPLICATE_OPENING",
                    detail: `Multiple retained openings claim accepted nullifier ${nullifier}`,
                });
            }
            continue;
        }

        const opening = group[0];
        const acceptedRecord = acceptedByNullifier.get(nullifier);
        if (!acceptedRecord) {
            issues.push({
                openingId: opening.openingId,
                issueClass: "EXTRA_UNBOUND",
                code: "NO_ACCEPTED_COMMITMENT",
                detail: "No accepted commitment at the frozen snapshot has this nullifier",
            });
            continue;
        }
        if (integerString(opening.commitment, "opening.commitment") !== acceptedRecord.commitment) {
            issues.push({
                openingId: opening.openingId,
                issueClass: "INVALID",
                code: "ACCEPTED_COMMITMENT_MISMATCH",
                detail: "Opening commitment differs from the accepted event commitment",
            });
            invalidOpeningCount++;
            continue;
        }
        try {
            if (!eventBindingMatches(opening, acceptedRecord)) {
                issues.push({
                    openingId: opening.openingId,
                    issueClass: "EXTRA_UNBOUND",
                    code: "ACCEPTED_EVENT_BINDING_MISMATCH",
                    detail: "Opening event locator or receipt hash differs from the accepted event",
                });
                continue;
            }
        } catch (error) {
            issues.push({
                openingId: opening.openingId,
                issueClass: "INVALID",
                code: "MALFORMED_EVENT_BINDING",
                detail: error instanceof Error ? error.message : String(error),
            });
            invalidOpeningCount++;
            continue;
        }
        included.push({ opening, accepted: acceptedRecord });
    }

    included.sort((a, b) => compareAccepted(a.accepted, b.accepted));
    const includedNullifiers = new Set(included.map((entry) => entry.accepted.nullifier));
    const missingAccepted = accepted.filter((record) => !includedNullifiers.has(record.nullifier));
    const counts = new Array(candidateCount).fill(0);
    for (const entry of included) {
        counts[Number(BigInt(entry.opening.vote))]++;
    }
    const resultVectorSum = counts.reduce((sum, count) => sum + count, 0);
    const duplicateIssueCount = issues.filter((issue) => issue.issueClass === "DUPLICATE").length;
    const extraIds = new Set(issues.filter((issue) => issue.issueClass === "EXTRA_UNBOUND").map((issue) => issue.openingId));
    const denominators: ReconciliationDenominators = {
        plannedBallots,
        submittedAttempts,
        acceptedCommitments: accepted.length,
        availableOpenings: openings.length,
        validOpenings: selfConsistentCount,
        includedOpenings: included.length,
        missingOpenings: missingAccepted.length,
        invalidOpenings: invalidOpeningCount,
        duplicateOpenings: duplicateIssueCount,
        extraUnboundOpenings: extraIds.size,
        resultVectorSum,
    };
    const publishable =
        included.length === accepted.length &&
        resultVectorSum === accepted.length &&
        missingAccepted.length === 0 &&
        invalidOpeningCount === 0 &&
        duplicateIssueCount === 0 &&
        extraIds.size === 0;

    return {
        schemaVersion: RECONCILIATION_SCHEMA_VERSION,
        snapshot: normalizedSnapshot,
        acceptedManifestHash: recomputedAcceptedManifestHash,
        openingManifestHash,
        evidencePartition: input.evidencePartition,
        evidenceWindow: input.evidenceWindow,
        candidateCount,
        counts,
        denominators,
        included,
        missingAccepted,
        issues,
        publishable,
    };
}

export function assertPublishableReconciliation(
    reconciliation: OpeningReconciliationResult
): OpeningReconciliationResult {
    if (!reconciliation.publishable) {
        throw new ReconciliationNotPublishableError(reconciliation);
    }
    return reconciliation;
}
