pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";

// Wrapper for Poseidon hash with 2 inputs
template PoseidonHash2() {
    signal input in[2];
    signal output out;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== in[0];
    hasher.inputs[1] <== in[1];
    out <== hasher.out;
}

// Wrapper for Poseidon hash with 1 input (for leaf computation)
template PoseidonHash1() {
    signal input in;
    signal output out;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== in;
    out <== hasher.out;
}

// Wrapper for Poseidon hash with 3 inputs (for commitment)
template PoseidonHash3() {
    signal input in[3];
    signal output out;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== in[0];
    hasher.inputs[1] <== in[1];
    hasher.inputs[2] <== in[2];
    out <== hasher.out;
}
