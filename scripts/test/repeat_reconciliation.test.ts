import test from "node:test";
import assert from "node:assert/strict";
import {
    ACCEPTED_MANIFEST_DOMAIN,
    AcceptedCommitment,
    AcceptedCommitmentSnapshot,
    RetainedOpening,
    assertPublishableReconciliation,
    canonicalManifestHash,
    reconcileOpenings,
    retainedOpeningFromReceipt,
} from "../src/lib/openingReconciliation.js";
import { assertPublicSignalBinding } from "../src/lib/publicSignals.js";
import {
    submitReconciledTally,
    tallyEvidenceFromReconciliation,
} from "../src/lib/tallySubmission.js";

const hash = (digit: string) => `0x${digit.repeat(64)}`;
const address = "0x00000000000000000000000000000000000000aa";
const commitmentFunction = async (vote: bigint, randomness: bigint) =>
    vote * 10_000n + randomness * 10n;

const accepted: AcceptedCommitment[] = [0, 1].map((index) => ({
    electionId: "7",
    nullifier: String(100 + index),
    commitment: String(BigInt(index) * 10_000n + BigInt(20 + index) * 10n),
    voter: address,
    receiptHash: hash(index === 0 ? "1" : "2"),
    transactionHash: hash(index === 0 ? "3" : "4"),
    blockNumber: 10 + index,
    blockHash: hash(index === 0 ? "5" : "6"),
    transactionIndex: index,
    logIndex: index,
}));

const snapshot = {
    schemaVersion: "ACCEPTED-COMMITMENT-SNAPSHOT-v1" as const,
    chainId: "31337",
    ballotBoxAddress: address,
    electionId: "7",
    fromBlock: 0,
    blockNumber: 12,
    blockHash: hash("7"),
};

const acceptedSnapshot: AcceptedCommitmentSnapshot = {
    snapshot,
    accepted,
    acceptedManifestHash: canonicalManifestHash(ACCEPTED_MANIFEST_DOMAIN, { snapshot, accepted }),
};

const openings: RetainedOpening[] = accepted.map((record, index) => ({
    openingId: `${record.transactionHash}:${record.logIndex}`,
    electionId: record.electionId,
    nullifier: record.nullifier,
    commitment: record.commitment,
    vote: index,
    randomness: 20 + index,
    acceptedEvent: {
        transactionHash: record.transactionHash,
        blockNumber: record.blockNumber,
        blockHash: record.blockHash,
        transactionIndex: record.transactionIndex,
        logIndex: record.logIndex,
        receiptHash: record.receiptHash,
    },
    capturePartition: "PRIVILEGED_LOCAL",
    captureWindow: "PRE_SECRET_RELEASE",
}));

const run = (candidateOpenings: RetainedOpening[], overrides = {}) => reconcileOpenings({
    acceptedSnapshot,
    openings: candidateOpenings,
    candidateCount: 2,
    plannedBallots: 2,
    submittedAttempts: 2,
    evidencePartition: "PRIVILEGED_LOCAL",
    evidenceWindow: "POST_SECRET_RELEASE",
    commitmentFunction,
    ...overrides,
});

test("S44R-CAPTURE-01 successful receipt yields one exactly event-bound opening", () => {
    const contract = {
        target: address,
        interface: {
            parseLog: () => ({
                name: "EncryptedVoteCast",
                args: {
                    electionId: 7n,
                    nullifier: 100n,
                    commitment: BigInt(accepted[0].commitment),
                    voter: address,
                    receiptHash: hash("1"),
                },
            }),
        },
    };
    const receipt = {
        status: 1,
        hash: hash("3"),
        blockNumber: 10,
        blockHash: hash("5"),
        index: 0,
        logs: [{ address, index: 0 }],
    };
    const opening = retainedOpeningFromReceipt(contract, receipt, {
        electionId: 7,
        nullifier: 100,
        commitment: accepted[0].commitment,
        vote: 0,
        randomness: 20,
        });
    assert.equal(opening.openingId, `${hash("3")}:0`);
    assert.equal(opening.capturePartition, "PRIVILEGED_LOCAL");
    assert.equal(opening.captureWindow, "PRE_SECRET_RELEASE");
});

test("S44R-CAPTURE-02 failed or event-less receipts cannot yield an opening", () => {
    const contract = { target: address, interface: { parseLog: () => null } };
    assert.throws(() => retainedOpeningFromReceipt(contract, {
        status: 0, hash: hash("3"), blockHash: hash("5"), logs: [],
    }, {
        electionId: 7, nullifier: 100, commitment: accepted[0].commitment,
        vote: 0, randomness: 20,
    }), /successful transaction receipt/);
    assert.throws(() => retainedOpeningFromReceipt(contract, {
        status: 1, hash: hash("3"), blockNumber: 10, blockHash: hash("5"), index: 0, logs: [],
    }, {
        electionId: 7, nullifier: 100, commitment: accepted[0].commitment,
        vote: 0, randomness: 20,
    }), /found 0/);
});

test("S44R-SIG-01 accepts the exact public workflow signal vector", () => {
    const evidence = assertPublicSignalBinding("PUBLIC_DISCLOSURE", [1, 2, 3, 0, 4, 9], {
        root: 1, nullifier: 2, electionId: 3, vote: 0, candidateCount: 4, voter: 9,
    });
    assert.equal(evidence.disposition, "MATCH");
});

test("S44R-SIG-02 accepts the exact commitment workflow signal vector", () => {
    assert.equal(assertPublicSignalBinding("COMMITMENT_BALLOT_HIDING", [1, 2, 3, 4, 5, 6], {
        root: 1, nullifier: 2, electionId: 3, candidateCount: 4, commitment: 5, voter: 6,
    }).disposition, "MATCH");
});

test("S44R-SIG-03 rejects a missing public signal", () => {
    assert.throws(() => assertPublicSignalBinding("PUBLIC_DISCLOSURE", [1, 2, 3, 0, 4], {
        root: 1, nullifier: 2, electionId: 3, vote: 0, candidateCount: 4, voter: 9,
    }), /requires 6/);
});

test("S44R-SIG-04 rejects reordered public signals", () => {
    assert.throws(() => assertPublicSignalBinding("PUBLIC_DISCLOSURE", [1, 3, 2, 0, 4, 9], {
        root: 1, nullifier: 2, electionId: 3, vote: 0, candidateCount: 4, voter: 9,
    }), /does not match/);
});

test("S44R-SIG-05 rejects a mismatched commitment signal", () => {
    assert.throws(() => assertPublicSignalBinding("COMMITMENT_BALLOT_HIDING", [1, 2, 3, 4, 5, 7], {
        root: 1, nullifier: 2, electionId: 3, candidateCount: 4, commitment: 5, voter: 6,
    }), /does not match/);
});

test("S44R-REC-01 complete one-to-one reconciliation is publishable", async () => {
    const result = await run(openings);
    assert.equal(result.publishable, true);
    assert.deepEqual(result.counts, [1, 1]);
    assert.deepEqual(result.denominators, {
        plannedBallots: 2,
        submittedAttempts: 2,
        acceptedCommitments: 2,
        availableOpenings: 2,
        validOpenings: 2,
        includedOpenings: 2,
        missingOpenings: 0,
        invalidOpenings: 0,
        duplicateOpenings: 0,
        extraUnboundOpenings: 0,
        resultVectorSum: 2,
    });
});

test("S44R-REC-02 missing opening is incomplete rather than a zero ballot", async () => {
    const result = await run(openings.slice(0, 1));
    assert.equal(result.publishable, false);
    assert.equal(result.denominators.missingOpenings, 1);
    assert.equal(result.denominators.resultVectorSum, 1);
    assert.throws(() => assertPublishableReconciliation(result), /incomplete/);
});

test("S44R-REC-02B a proper subset cannot be published as a complete result", async () => {
    const result = await run([openings[1]]);
    assert.equal(result.denominators.availableOpenings, 1);
    assert.equal(result.denominators.acceptedCommitments, 2);
    assert.equal(result.denominators.includedOpenings, 1);
    assert.equal(result.publishable, false);
});

test("S44R-REC-03 altered vote is invalid", async () => {
    const changed = structuredClone(openings);
    changed[0].vote = 1;
    const result = await run(changed);
    assert.equal(result.publishable, false);
    assert.ok(result.issues.some((issue) => issue.code === "COMMITMENT_MISMATCH"));
});

test("S44R-REC-04 altered randomness is invalid", async () => {
    const changed = structuredClone(openings);
    changed[0].randomness = 99;
    const result = await run(changed);
    assert.ok(result.issues.some((issue) => issue.code === "COMMITMENT_MISMATCH"));
});

test("S44R-REC-05 altered retained commitment is locally invalid", async () => {
    const changed = structuredClone(openings);
    changed[0].commitment = String(BigInt(changed[0].commitment) + 1n);
    const result = await run(changed);
    assert.equal(result.publishable, false);
    assert.ok(result.denominators.invalidOpenings > 0);
});

test("S44R-REC-05B self-consistent opening that disagrees with accepted manifest is rejected", async () => {
    const changedAccepted = structuredClone(accepted);
    changedAccepted[0].commitment = String(BigInt(changedAccepted[0].commitment) + 1n);
    const changedSnapshot: AcceptedCommitmentSnapshot = {
        snapshot,
        accepted: changedAccepted,
        acceptedManifestHash: canonicalManifestHash(
            ACCEPTED_MANIFEST_DOMAIN,
            { snapshot, accepted: changedAccepted }
        ),
    };
    const result = await run(openings, { acceptedSnapshot: changedSnapshot });
    assert.equal(result.denominators.validOpenings, 2);
    assert.ok(result.issues.some((issue) => issue.code === "ACCEPTED_COMMITMENT_MISMATCH"));
    assert.equal(result.publishable, false);
});

test("S44R-REC-06 duplicate opening invalidates the matched accepted record", async () => {
    const duplicate = structuredClone(openings[0]);
    const result = await run([...openings, duplicate]);
    assert.equal(result.denominators.duplicateOpenings, 2);
    assert.equal(result.denominators.missingOpenings, 1);
    assert.equal(result.publishable, false);
});

test("S44R-REC-07 extra unbound but internally valid opening is excluded", async () => {
    const extra = structuredClone(openings[0]);
    extra.nullifier = 999;
    extra.acceptedEvent.transactionHash = hash("f");
    extra.acceptedEvent.logIndex = 9;
    extra.openingId = `${extra.acceptedEvent.transactionHash}:9`;
    const result = await run([...openings, extra]);
    assert.equal(result.denominators.extraUnboundOpenings, 1);
    assert.equal(result.denominators.includedOpenings, 2);
    assert.equal(result.publishable, false);
});

test("S44R-REC-08 swapped event binding is rejected", async () => {
    const changed = structuredClone(openings);
    [changed[0].acceptedEvent, changed[1].acceptedEvent] = [changed[1].acceptedEvent, changed[0].acceptedEvent];
    changed[0].openingId = `${changed[0].acceptedEvent.transactionHash}:${changed[0].acceptedEvent.logIndex}`;
    changed[1].openingId = `${changed[1].acceptedEvent.transactionHash}:${changed[1].acceptedEvent.logIndex}`;
    const result = await run(changed);
    assert.equal(result.denominators.extraUnboundOpenings, 2);
    assert.equal(result.publishable, false);
});

test("S44R-REC-09 a local capture cannot silently become PUBLIC evidence", async () => {
    const result = await run(openings, { evidencePartition: "PUBLIC" });
    assert.equal(result.publishable, false);
    assert.ok(result.issues.every((issue) => issue.code === "EVIDENCE_PARTITION_MISMATCH"));
});

test("S44R-REC-09B explicit POST release permits a public evidence package", async () => {
    const released = structuredClone(openings);
    for (const opening of released) {
        opening.release = {
            schemaVersion: "OPENING-RELEASE-v1",
            state: "RELEASED",
            releasedAt: "2026-08-17T00:00:00.000Z",
            evidenceWindow: "POST_SECRET_RELEASE",
            exportManifestHash: hash("e"),
        };
    }
    const result = await run(released, {
        evidencePartition: "PUBLIC",
        evidenceWindow: "POST_SECRET_RELEASE",
    });
    assert.equal(result.publishable, true);
    assert.equal(result.evidencePartition, "PUBLIC");
});

test("S44R-REC-10 PRE and POST analytical windows remain atomic", async () => {
    const postCaptured = structuredClone(openings);
    postCaptured[0].captureWindow = "POST_SECRET_RELEASE";
    const result = await run(postCaptured, { evidenceWindow: "PRE_SECRET_RELEASE" });
    assert.ok(result.issues.some((issue) => issue.code === "EVIDENCE_WINDOW_MISMATCH"));
    assert.equal(result.evidenceWindow, "PRE_SECRET_RELEASE");
});

test("S44R-REC-11 accepted manifest tampering is rejected", async () => {
    await assert.rejects(() => run(openings, {
        acceptedSnapshot: { ...acceptedSnapshot, acceptedManifestHash: hash("f") },
    }), /manifest hash does not match/);
});

test("S44R-TALLY-01 complete POST evidence maps to the exact contract tuple", async () => {
    const evidence = tallyEvidenceFromReconciliation(await run(openings));
    assert.equal(evidence.acceptedCommitments, 2);
    assert.equal(evidence.includedOpenings, 2);
    assert.equal(evidence.evidenceWindow, 2);
    assert.equal(evidence.claimedDigest, hash("0"));
});

const publisher = "0x00000000000000000000000000000000000000bb";

function mockBallotBox(storedHash = hash("8"), requirePrepared = () => true) {
    return {
        getAddress: async () => address,
        computeTallyEvidenceHash: async () => hash("8"),
        submitTally: async () => {
            assert.equal(requirePrepared(), true, "canonical package must exist before broadcast");
            return { wait: async () => ({ status: 1, hash: hash("a"), blockNumber: 13 }) };
        },
        tallyEvidenceHash: async () => storedHash,
        tallyPublicationVersion: async () => 1,
        tallyStatus: async () => 1,
        tallyPublisher: async () => publisher,
    };
}

test("S44R-PREIMAGE-01 available canonical preimage is persisted before broadcast", async () => {
    const reconciliation = await run(openings);
    let prepared: unknown = null;
    let receiptUpdated = false;
    const result = await submitReconciledTally(
        mockBallotBox(hash("8"), () => prepared !== null),
        7,
        reconciliation,
        publisher,
        1,
        {
            onPrepared: (value) => { prepared = value; },
            onReceipt: () => { receiptUpdated = true; },
        }
    );
    assert.ok(prepared);
    assert.equal(result.evidenceHash, hash("8"));
    assert.equal(receiptUpdated, true);
});

test("S44R-PREIMAGE-02 unavailable/incomplete preimage blocks broadcast", async () => {
    const incomplete = await run(openings.slice(0, 1));
    let prepared = false;
    await assert.rejects(() => submitReconciledTally(
        mockBallotBox(),
        7,
        incomplete,
        publisher,
        1,
        { onPrepared: () => { prepared = true; } }
    ), /incomplete/);
    assert.equal(prepared, false);
});

test("S44R-PREIMAGE-03 mismatched stored digest is rejected after receipt", async () => {
    const reconciliation = await run(openings);
    let receiptUpdated = false;
    await assert.rejects(() => submitReconciledTally(
        mockBallotBox(hash("9")),
        7,
        reconciliation,
        publisher,
        1,
        {
            onPrepared: () => undefined,
            onReceipt: () => { receiptUpdated = true; },
        }
    ), /read-back does not match/);
    assert.equal(receiptUpdated, false);
});

test("S44R-PERSIST-01 prepared-package persistence failure prevents broadcast", async () => {
    const reconciliation = await run(openings);
    let broadcast = false;
    const ballotBox = mockBallotBox();
    ballotBox.submitTally = async () => {
        broadcast = true;
        return { wait: async () => ({ status: 1, hash: hash("a"), blockNumber: 13 }) };
    };
    await assert.rejects(() => submitReconciledTally(
        ballotBox,
        7,
        reconciliation,
        publisher,
        1,
        { onPrepared: () => { throw new Error("PREPARED_PACKAGE_WRITE_FAILED"); } }
    ), /PREPARED_PACKAGE_WRITE_FAILED/);
    assert.equal(broadcast, false);
});

test("S44R-PERSIST-02 receipt-update failure remains an explicit post-publication failure", async () => {
    const reconciliation = await run(openings);
    let prepared = false;
    await assert.rejects(() => submitReconciledTally(
        mockBallotBox(hash("8"), () => prepared),
        7,
        reconciliation,
        publisher,
        1,
        {
            onPrepared: () => { prepared = true; },
            onReceipt: () => { throw new Error("RECEIPT_PACKAGE_UPDATE_FAILED"); },
        }
    ), /RECEIPT_PACKAGE_UPDATE_FAILED/);
    assert.equal(prepared, true);
});
