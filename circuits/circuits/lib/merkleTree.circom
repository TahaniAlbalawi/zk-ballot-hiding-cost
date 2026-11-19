pragma circom 2.1.6;

include "./poseidon.circom";

// Merkle tree membership proof verifier using Poseidon hash
// DEPTH is the tree depth (number of levels)
template MerkleTreeVerifier(DEPTH) {
    // Input leaf value
    signal input leaf;
    // Merkle path elements (sibling hashes)
    signal input pathElements[DEPTH];
    // Path indices (0 = left, 1 = right)
    signal input pathIndices[DEPTH];
    // Expected root
    signal input root;

    // Compute the root from leaf and path
    signal computedHashes[DEPTH + 1];
    computedHashes[0] <== leaf;

    component hashers[DEPTH];
    
    // Intermediate signals for mux computation (must be arrays outside loop)
    // Each level needs intermediate products
    signal prod1[DEPTH];  // (1 - pathIndices[i]) * computedHashes[i]
    signal prod2[DEPTH];  // pathIndices[i] * pathElements[i]
    signal prod3[DEPTH];  // pathIndices[i] * computedHashes[i]
    signal prod4[DEPTH];  // (1 - pathIndices[i]) * pathElements[i]
    signal leftInput[DEPTH];
    signal rightInput[DEPTH];

    for (var i = 0; i < DEPTH; i++) {
        // Ensure pathIndices[i] is binary (0 or 1)
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        hashers[i] = PoseidonHash2();

        // Break down into quadratic constraints
        // For left input: (1 - pathIndices[i]) * computedHashes[i] + pathIndices[i] * pathElements[i]
        // For right input: pathIndices[i] * computedHashes[i] + (1 - pathIndices[i]) * pathElements[i]
        
        // Compute each product separately
        prod1[i] <== (1 - pathIndices[i]) * computedHashes[i];
        prod2[i] <== pathIndices[i] * pathElements[i];
        prod3[i] <== pathIndices[i] * computedHashes[i];
        prod4[i] <== (1 - pathIndices[i]) * pathElements[i];
        
        // Now combine (these are linear, which is allowed)
        leftInput[i] <== prod1[i] + prod2[i];
        rightInput[i] <== prod3[i] + prod4[i];

        hashers[i].in[0] <== leftInput[i];
        hashers[i].in[1] <== rightInput[i];

        computedHashes[i + 1] <== hashers[i].out;
    }

    // Assert computed root matches expected root
    root === computedHashes[DEPTH];
}
