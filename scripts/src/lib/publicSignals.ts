/**
 * Exact client-side binding for the public signals consumed by the Solidity
 * verifiers.  The caller reconstructs the expected values independently from
 * the witness/prover output and must complete this check before broadcasting.
 */

// voter is the submitting account, uint160(msg.sender); the contracts append it
// to every statement so a copied transaction from another account fails.
// Both commitment workflows cast identically and share one order.
export const PUBLIC_SIGNAL_ORDERS = {
    PUBLIC_DISCLOSURE: [
        "root",
        "nullifier",
        "electionId",
        "vote",
        "candidateCount",
        "voter",
    ],
    COMMITMENT_BALLOT_HIDING: [
        "root",
        "nullifier",
        "electionId",
        "candidateCount",
        "commitment",
        "voter",
    ],
    COMMITMENT_ONCHAIN_REVEAL: [
        "root",
        "nullifier",
        "electionId",
        "candidateCount",
        "commitment",
        "voter",
    ],
} as const;

export type WorkflowMode = keyof typeof PUBLIC_SIGNAL_ORDERS;
export type SignalLike = string | number | bigint;

export type PublicSignalEvidence = {
    schemaVersion: "PUBLIC-SIGNAL-BINDING-v2";
    workflowMode: WorkflowMode;
    order: readonly string[];
    expected: string[];
    observed: string[];
    disposition: "MATCH" | "REJECTED";
    failureCode?: string;
    failedIndex?: number;
    failedField?: string;
};

export class PublicSignalBindingError extends Error {
    readonly code: string;
    readonly evidence: PublicSignalEvidence;

    constructor(code: string, message: string, evidence: PublicSignalEvidence) {
        super(message);
        this.name = "PublicSignalBindingError";
        this.code = code;
        this.evidence = evidence;
    }
}

function normalizeSignal(value: SignalLike, label: string): string {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }

    let normalized: bigint;
    try {
        normalized = BigInt(value);
    } catch {
        throw new Error(`${label} is not an integer field element`);
    }

    if (normalized < 0n) {
        throw new Error(`${label} must be non-negative`);
    }
    return normalized.toString(10);
}

/**
 * Require exact count, circuit-defined order, and value equality.  The
 * returned decimal strings are suitable for evidence logs; transaction
 * arguments should still come from the independently reconstructed inputs.
 */
export function assertPublicSignalBinding(
    workflowMode: WorkflowMode,
    observedSignals: readonly SignalLike[],
    expectedByField: Readonly<Record<string, SignalLike>>
): PublicSignalEvidence {
    const order = PUBLIC_SIGNAL_ORDERS[workflowMode];
    const observed: string[] = [];
    const expected: string[] = [];

    if (!Array.isArray(observedSignals) || observedSignals.length !== order.length) {
        const evidence: PublicSignalEvidence = {
            schemaVersion: "PUBLIC-SIGNAL-BINDING-v2",
            workflowMode,
            order,
            expected: order.map((field) => normalizeSignal(expectedByField[field], `expected.${field}`)),
            observed: Array.isArray(observedSignals)
                ? observedSignals.map((value, index) => normalizeSignal(value, `observed[${index}]`))
                : [],
            disposition: "REJECTED",
            failureCode: "PUBLIC_SIGNAL_COUNT_MISMATCH",
        };
        throw new PublicSignalBindingError(
            "PUBLIC_SIGNAL_COUNT_MISMATCH",
            `${workflowMode} requires ${order.length} public signals; received ${observedSignals?.length ?? 0}`,
            evidence
        );
    }

    for (let index = 0; index < order.length; index++) {
        const field = order[index];
        let expectedValue: string;
        let observedValue: string;
        try {
            expectedValue = normalizeSignal(expectedByField[field], `expected.${field}`);
            observedValue = normalizeSignal(observedSignals[index], `observed.${field}`);
        } catch (error) {
            const evidence: PublicSignalEvidence = {
                schemaVersion: "PUBLIC-SIGNAL-BINDING-v2",
                workflowMode,
                order,
                expected,
                observed,
                disposition: "REJECTED",
                failureCode: "PUBLIC_SIGNAL_MALFORMED",
                failedIndex: index,
                failedField: field,
            };
            throw new PublicSignalBindingError(
                "PUBLIC_SIGNAL_MALFORMED",
                error instanceof Error ? error.message : String(error),
                evidence
            );
        }

        expected.push(expectedValue);
        observed.push(observedValue);
        if (expectedValue !== observedValue) {
            const evidence: PublicSignalEvidence = {
                schemaVersion: "PUBLIC-SIGNAL-BINDING-v2",
                workflowMode,
                order,
                expected: [...expected],
                observed: [...observed],
                disposition: "REJECTED",
                failureCode: "PUBLIC_SIGNAL_VALUE_MISMATCH",
                failedIndex: index,
                failedField: field,
            };
            throw new PublicSignalBindingError(
                "PUBLIC_SIGNAL_VALUE_MISMATCH",
                `${workflowMode} public signal ${index} (${field}) does not match the reconstructed transaction argument`,
                evidence
            );
        }
    }

    return {
        schemaVersion: "PUBLIC-SIGNAL-BINDING-v2",
        workflowMode,
        order,
        expected,
        observed,
        disposition: "MATCH",
    };
}
