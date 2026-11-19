import { createHash } from "node:crypto";

const SECRET_SEED_DOMAIN = Buffer.from("CMC-P3.2-SECRET-SEED-v1", "ascii");
const HEX_32_BYTES = /^[0-9a-f]{64}$/;

/**
 * Decode the privileged 32-byte custody seed. The hexadecimal transport form
 * is accepted only in memory and must never be written to logs or metadata.
 */
export function decodeSecretSeed(seedHex: string): Buffer {
    if (!HEX_32_BYTES.test(seedHex)) {
        throw new Error("DEMO_SEED must be exactly 32 bytes encoded as 64 lowercase hexadecimal characters");
    }
    return Buffer.from(seedHex, "hex");
}

/** CMC-P3.2-v1.1 K_SECRET_COMMITMENT, encoded as lowercase SHA-256. */
export function secretSeedCommitment(seedHex: string): string {
    return createHash("sha256")
        .update(SECRET_SEED_DOMAIN)
        .update(Buffer.from([0]))
        .update(decodeSecretSeed(seedHex))
        .digest("hex");
}

export function seedCustodyMetadata(seedHex: string, custodyId?: string): {
    seedCommitment: string;
    seedCustodyId?: string;
} {
    return {
        seedCommitment: secretSeedCommitment(seedHex),
        ...(custodyId ? { seedCustodyId: custodyId } : {}),
    };
}
