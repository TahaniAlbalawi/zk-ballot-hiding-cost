/**
 * Merkle tree implementation using Poseidon hash
 */
import { poseidonHash2 } from "./poseidon.js";

export interface MerkleProof {
    pathElements: bigint[];
    pathIndices: number[];
}

export interface MerkleTree {
    root: bigint;
    depth: number;
    leaves: bigint[];
    layers: bigint[][];
}

/**
 * Build a Merkle tree from leaf values
 */
export async function buildMerkleTree(
    leaves: bigint[],
    depth: number
): Promise<MerkleTree> {
    // Pad leaves to 2^depth
    const targetSize = Math.pow(2, depth);
    if (leaves.length > targetSize) {
        throw new Error(
            `Too many leaves (${leaves.length}) for depth ${depth} (max ${targetSize})`
        );
    }

    // Pad with zeros
    const paddedLeaves = [...leaves];
    while (paddedLeaves.length < targetSize) {
        paddedLeaves.push(0n);
    }

    // Build layers bottom-up
    const layers: bigint[][] = [paddedLeaves];

    let currentLayer = paddedLeaves;
    for (let i = 0; i < depth; i++) {
        const nextLayer: bigint[] = [];
        for (let j = 0; j < currentLayer.length; j += 2) {
            const left = currentLayer[j];
            const right = currentLayer[j + 1];
            const hash = await poseidonHash2(left, right);
            nextLayer.push(hash);
        }
        layers.push(nextLayer);
        currentLayer = nextLayer;
    }

    return {
        root: layers[layers.length - 1][0],
        depth,
        leaves: paddedLeaves,
        layers,
    };
}

/**
 * Generate a Merkle proof for a leaf at given index
 */
export function getMerkleProof(tree: MerkleTree, leafIndex: number): MerkleProof {
    if (leafIndex >= tree.leaves.length) {
        throw new Error(`Invalid leaf index: ${leafIndex}`);
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    let currentIndex = leafIndex;
    for (let i = 0; i < tree.depth; i++) {
        const layer = tree.layers[i];
        const isLeftNode = currentIndex % 2 === 0;
        const siblingIndex = isLeftNode ? currentIndex + 1 : currentIndex - 1;

        pathElements.push(layer[siblingIndex]);
        pathIndices.push(isLeftNode ? 0 : 1);

        currentIndex = Math.floor(currentIndex / 2);
    }

    return { pathElements, pathIndices };
}

/**
 * Verify a Merkle proof
 */
export async function verifyMerkleProof(
    leaf: bigint,
    proof: MerkleProof,
    root: bigint
): Promise<boolean> {
    let currentHash = leaf;

    for (let i = 0; i < proof.pathElements.length; i++) {
        const sibling = proof.pathElements[i];
        const isLeft = proof.pathIndices[i] === 0;

        if (isLeft) {
            currentHash = await poseidonHash2(currentHash, sibling);
        } else {
            currentHash = await poseidonHash2(sibling, currentHash);
        }
    }

    return currentHash === root;
}
