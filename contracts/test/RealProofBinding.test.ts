import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import path from "node:path";
import { existsSync } from "node:fs";
// snarkjs and circomlibjs ship without type declarations.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const snarkjs = require("snarkjs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const circomlibjs = require("circomlibjs");

// Real Groth16 proofs for the D05-C04 artifacts produced by `npm run circuits:build`.
const DEPTH = 5;
const CANDIDATES = 4;
const bundleRoot = path.resolve(__dirname, "..", "..", "circuits", "build", "configurations", "D05-C04");
const artifacts = {
    public: {
        wasm: path.join(bundleRoot, "public", "VoteProof_D05_C04_js", "VoteProof_D05_C04.wasm"),
        zkey: path.join(bundleRoot, "public", "VoteProof_D05_C04_final.zkey"),
    },
    commitment: {
        wasm: path.join(bundleRoot, "commitment", "VoteProofPrivate_D05_C04_js", "VoteProofPrivate_D05_C04.wasm"),
        zkey: path.join(bundleRoot, "commitment", "VoteProofPrivate_D05_C04_final.zkey"),
    },
};
const haveArtifacts = Object.values(artifacts).every((a) => existsSync(a.wasm) && existsSync(a.zkey));
const realProofDescribe = haveArtifacts ? describe : describe.skip;

type SolidityProof = {
    a: [bigint, bigint];
    b: [[bigint, bigint], [bigint, bigint]];
    c: [bigint, bigint];
};

function toSolidityProof(proof: any): SolidityProof {
    return {
        a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
        b: [
            [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
            [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
        ],
        c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
    };
}

realProofDescribe("Real-proof sender binding and on-chain reveal (D05-C04)", function () {
    this.timeout(180000);

    let poseidon: any;
    const hash = (inputs: bigint[]): bigint => poseidon.F.toObject(poseidon(inputs));
    const secrets = [111n, 222n, 333n];
    let root: bigint;
    let paths: Array<{ pathElements: bigint[]; pathIndices: number[] }>;

    before(async function () {
        poseidon = await circomlibjs.buildPoseidon();
        // Depth-5 tree with the voters' leaves first and zero leaves elsewhere.
        let level: bigint[] = Array.from({ length: 2 ** DEPTH }, (_, i) => (i < secrets.length ? hash([secrets[i]]) : 0n));
        const levels: bigint[][] = [level];
        for (let d = 0; d < DEPTH; d++) {
            const next: bigint[] = [];
            for (let i = 0; i < level.length; i += 2) next.push(hash([level[i], level[i + 1]]));
            levels.push(next);
            level = next;
        }
        root = level[0];
        paths = secrets.map((_, leafIndex) => {
            const pathElements: bigint[] = [];
            const pathIndices: number[] = [];
            let index = leafIndex;
            for (let d = 0; d < DEPTH; d++) {
                pathIndices.push(index & 1);
                pathElements.push(levels[d][index ^ 1]);
                index >>= 1;
            }
            return { pathElements, pathIndices };
        });
    });

    async function deploy() {
        const registry = await (await ethers.getContractFactory("ElectionRegistry")).deploy();
        const publicVerifier = await (await ethers.getContractFactory("Groth16VerifierPublicD05C04")).deploy();
        const commitmentVerifier = await (await ethers.getContractFactory("Groth16VerifierCommitmentD05C04")).deploy();
        const ballotBox = await (await ethers.getContractFactory("BallotBox")).deploy(
            await registry.getAddress(),
            await publicVerifier.getAddress(),
        );
        await ballotBox.setVerifierPrivate(await commitmentVerifier.getAddress());
        const [signer] = await ethers.getSigners();
        const hasher = await new ethers.ContractFactory(
            circomlibjs.poseidonContract.generateABI(2),
            circomlibjs.poseidonContract.createCode(2),
            signer,
        ).deploy();
        await ballotBox.setCommitmentHasher(await hasher.getAddress());
        return { registry, ballotBox };
    }

    async function window() {
        const start = (await time.latest()) + 10;
        return { start, end: start + 1000, revealEnd: start + 2000 };
    }

    async function proveCommitment(voterIndex: number, electionId: bigint, voter: string, vote: number, randomness: bigint) {
        const commitment = hash([BigInt(vote), randomness]);
        const nullifier = hash([secrets[voterIndex], electionId]);
        const { proof } = await snarkjs.groth16.fullProve({
            root, nullifier, electionId, candidateCount: CANDIDATES, commitment, voter: BigInt(voter),
            secret: secrets[voterIndex], ...paths[voterIndex], vote, randomness,
        }, artifacts.commitment.wasm, artifacts.commitment.zkey);
        return { commitment, nullifier, proof: toSolidityProof(proof) };
    }

    it("accepts a public ballot only from the account bound in the proof", async function () {
        const { registry, ballotBox } = await deploy();
        const [, alice, mallory] = await ethers.getSigners();
        const w = await window();
        const electionId = await registry.electionCount();
        await registry.createElection(ethers.toBeHex(root, 32), CANDIDATES, w.start, w.end);
        await time.increaseTo(w.start);

        const vote = 2;
        const nullifier = hash([secrets[0], electionId]);
        const { proof } = await snarkjs.groth16.fullProve({
            root, nullifier, electionId, vote, candidateCount: CANDIDATES, voter: BigInt(alice.address),
            secret: secrets[0], ...paths[0],
        }, artifacts.public.wasm, artifacts.public.zkey);
        const p = toSolidityProof(proof);

        // A copied pending call submitted from another account fails verification.
        await expect(ballotBox.connect(mallory).castVote(electionId, nullifier, vote, p.a, p.b, p.c))
            .to.be.revertedWithCustomError(ballotBox, "InvalidProof");
        await expect(ballotBox.connect(alice).castVote(electionId, nullifier, vote, p.a, p.b, p.c))
            .to.emit(ballotBox, "VoteCast");
    });

    it("accepts a commitment ballot only from the bound account and reveals it on-chain", async function () {
        const { registry, ballotBox } = await deploy();
        const [, alice, mallory, auditor] = await ethers.getSigners();
        const w = await window();
        const electionId = await registry.electionCount();
        await registry.createRevealElection(ethers.toBeHex(root, 32), CANDIDATES, w.start, w.end, w.revealEnd);
        await time.increaseTo(w.start);

        const vote = 3;
        const randomness = 0x1234567890abcdefn;
        const c = await proveCommitment(1, electionId, alice.address, vote, randomness);
        await expect(ballotBox.connect(mallory).castVotePrivate(electionId, c.nullifier, c.commitment, c.proof.a, c.proof.b, c.proof.c))
            .to.be.revertedWithCustomError(ballotBox, "InvalidProof");
        await expect(ballotBox.connect(alice).castVotePrivate(electionId, c.nullifier, c.commitment, c.proof.a, c.proof.b, c.proof.c))
            .to.emit(ballotBox, "EncryptedVoteCast");

        await time.increaseTo(w.end + 1);
        await expect(ballotBox.connect(auditor).revealVotes(electionId, [0], [vote], [randomness]))
            .to.emit(ballotBox, "VoteRevealed").withArgs(electionId, 0n, vote, auditor.address);
        expect(await ballotBox.getResults(electionId)).to.deep.equal([0n, 0n, 0n, 1n]);
    });

    it("accepts the same commitment proof shape on a publisher-workflow election", async function () {
        const { registry, ballotBox } = await deploy();
        const [, alice] = await ethers.getSigners();
        const w = await window();
        const electionId = await registry.electionCount();
        await registry.createPrivateElection(ethers.toBeHex(root, 32), CANDIDATES, w.start, w.end);
        await time.increaseTo(w.start);

        const c = await proveCommitment(2, electionId, alice.address, 0, 42n);
        await expect(ballotBox.connect(alice).castVotePrivate(electionId, c.nullifier, c.commitment, c.proof.a, c.proof.b, c.proof.c))
            .to.emit(ballotBox, "EncryptedVoteCast");
        expect(await ballotBox.encryptedBallotCount(electionId)).to.equal(1n);
    });
});
