/**
 * Poseidon hash wrapper using circomlibjs
 */
import { buildPoseidon } from "circomlibjs";

interface PoseidonInstance {
    (inputs: bigint[]): unknown;
    F: {
        p: bigint | { toString(): string };
        toObject(value: unknown): bigint | { toString(): string };
    };
}

let poseidon: PoseidonInstance | null = null;

export async function getPoseidon(): Promise<PoseidonInstance> {
    if (!poseidon) {
        poseidon = await buildPoseidon() as PoseidonInstance;
    }
    return poseidon;
}

/**
 * Hash a single field element
 */
export async function poseidonHash1(input: bigint): Promise<bigint> {
    const poseidon = await getPoseidon();
    const hash = poseidon([input]);
    return BigInt(poseidon.F.toObject(hash).toString());
}

/**
 * Hash two field elements
 */
export async function poseidonHash2(a: bigint, b: bigint): Promise<bigint> {
    const poseidon = await getPoseidon();
    const hash = poseidon([a, b]);
    return BigInt(poseidon.F.toObject(hash).toString());
}

/**
 * Get the SNARK field prime
 */
export async function getFieldPrime(): Promise<bigint> {
    const poseidon = await getPoseidon();
    return BigInt(poseidon.F.p.toString());
}
