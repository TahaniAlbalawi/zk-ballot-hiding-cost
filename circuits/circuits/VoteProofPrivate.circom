pragma circom 2.1.6;

include "./lib/poseidon.circom";
include "./lib/merkleTree.circom";

/*
 * VoteProofPrivate Circuit
 * 
 * Proves (for Private Commitment-Based Mode; 'Encrypted' naming elsewhere is historical):
 * 1. Voter eligibility via Merkle tree membership
 * 2. Correct nullifier derivation (prevents double voting)
 * 3. Vote is within valid candidate range [0, candidateCount-1]
 * 4. Commitment correctness: commitment = Poseidon(vote, randomness)
 *
 * Public inputs: root, nullifier, electionId, candidateCount, commitment, voter
 * Private inputs: secret, pathElements, pathIndices, vote, randomness
 *
 * The commitment hides the vote until (vote, randomness) are disclosed; no
 * decryption exists. Election binding comes from the election-scoped nullifier
 * and per-election storage, so no election key enters the commitment.
 * voter is the submitting account (uint160(msg.sender)); see VoteProof.circom.
 */

template VoteProofPrivate(TREE_DEPTH, MAX_CANDIDATES) {
    // === Public Inputs ===
    signal input root;           // Merkle root of eligible voters
    signal input nullifier;      // Derived nullifier (public to prevent double voting)
    signal input electionId;     // Election identifier
    signal input candidateCount; // Number of candidates
    signal input commitment;     // Vote commitment (Poseidon hash; not ciphertext)
    signal input voter;          // Submitting account, uint160(msg.sender)

    // === Private Inputs ===
    signal input secret;                     // Voter's secret
    signal input pathElements[TREE_DEPTH];   // Merkle proof path elements
    signal input pathIndices[TREE_DEPTH];    // Merkle proof path indices (0/1)
    signal input vote;                       // Vote choice (private in this mode!)
    signal input randomness;                 // Commitment randomness

    // === Constraint 1: Compute leaf from secret ===
    component leafHasher = PoseidonHash1();
    leafHasher.in <== secret;
    signal leaf;
    leaf <== leafHasher.out;

    // === Constraint 2: Verify Merkle membership ===
    component merkleVerifier = MerkleTreeVerifier(TREE_DEPTH);
    merkleVerifier.leaf <== leaf;
    merkleVerifier.root <== root;
    for (var i = 0; i < TREE_DEPTH; i++) {
        merkleVerifier.pathElements[i] <== pathElements[i];
        merkleVerifier.pathIndices[i] <== pathIndices[i];
    }

    // === Constraint 3: Compute and verify nullifier ===
    component nullifierHasher = PoseidonHash2();
    nullifierHasher.in[0] <== secret;
    nullifierHasher.in[1] <== electionId;
    
    signal computedNullifier;
    computedNullifier <== nullifierHasher.out;
    
    // Assert nullifier matches the public input
    nullifier === computedNullifier;

    // === Constraint 4: Bind the configuration-specific candidate upper bound ===
    // The four-bit representation is retained for the frozen 1..16
    // candidate envelope; configuration-specific entrypoints bind its upper
    // endpoint through MAX_CANDIDATES without changing public inputs.
    signal candidateCountCheck;
    candidateCountCheck <== MAX_CANDIDATES - candidateCount;
    signal candidateRangeBits[4];
    var candidateRangeAccumulator = 0;
    for (var i = 0; i < 4; i++) {
        candidateRangeBits[i] <-- (candidateCountCheck >> i) & 1;
        candidateRangeBits[i] * (1 - candidateRangeBits[i]) === 0;
        candidateRangeAccumulator += candidateRangeBits[i] * (1 << i);
    }
    candidateCountCheck === candidateRangeAccumulator;

    // === Constraint 5: Range check for vote ===
    // Decompose vote into bits (4 bits for MAX_CANDIDATES = 16)
    signal voteBits[4];
    var accumulator = 0;
    for (var i = 0; i < 4; i++) {
        voteBits[i] <-- (vote >> i) & 1;
        voteBits[i] * (1 - voteBits[i]) === 0; // Ensure bit is 0 or 1
        accumulator += voteBits[i] * (1 << i);
    }
    
    // Verify decomposition is correct
    vote === accumulator;
    
    // Verify vote < candidateCount
    signal voteRangeCheck;
    voteRangeCheck <== candidateCount - 1 - vote;
    
    // Decompose range check into bits (must be non-negative)
    signal rangeBits[4];
    var rangeAccumulator = 0;
    for (var i = 0; i < 4; i++) {
        rangeBits[i] <-- (voteRangeCheck >> i) & 1;
        rangeBits[i] * (1 - rangeBits[i]) === 0;
        rangeAccumulator += rangeBits[i] * (1 << i);
    }
    
    // Verify the range check value equals the bit decomposition
    voteRangeCheck === rangeAccumulator;

    // === Constraint 6: Commitment correctness ===
    // commitment = Poseidon(vote, randomness)
    // This proves we know the vote value bound in the commitment
    component commitmentHasher = PoseidonHash2();
    commitmentHasher.in[0] <== vote;
    commitmentHasher.in[1] <== randomness;

    signal computedCommitment;
    computedCommitment <== commitmentHasher.out;

    // Assert commitment matches
    commitment === computedCommitment;

    // === Constraint 7: Bind the submitting account ===
    signal voterSquare;
    voterSquare <== voter * voter;
}

// Configuration-specific entrypoints instantiate this unchanged template.
