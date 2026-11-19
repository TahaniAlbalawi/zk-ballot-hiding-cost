import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ElectionRegistry, BallotBox } from "../typechain-types";
// circomlibjs ships without type declarations.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const circomlibjs = require("circomlibjs");

const ZERO_PROOF = {
    a: [0n, 0n] as [bigint, bigint],
    b: [[0n, 0n], [0n, 0n]] as [[bigint, bigint], [bigint, bigint]],
    c: [0n, 0n] as [bigint, bigint],
};
const ROOT = ethers.keccak256(ethers.toUtf8Bytes("reveal-root"));

describe("COMMITMENT_REVEAL workflow", function () {
    let registry: ElectionRegistry;
    let ballotBox: BallotBox;
    let poseidon: any;
    let electionId: bigint;
    let endTime: number;
    let revealEndTime: number;

    function commit(vote: number, randomness: bigint): bigint {
        return poseidon.F.toObject(poseidon([BigInt(vote), randomness]));
    }

    async function deployPoseidon2(): Promise<string> {
        const [signer] = await ethers.getSigners();
        const factory = new ethers.ContractFactory(
            circomlibjs.poseidonContract.generateABI(2),
            circomlibjs.poseidonContract.createCode(2),
            signer,
        );
        const hasher = await factory.deploy();
        await hasher.waitForDeployment();
        return hasher.getAddress();
    }

    async function createRevealElection(candidateCount: number): Promise<bigint> {
        const start = (await time.latest()) + 10;
        endTime = start + 100;
        revealEndTime = endTime + 100;
        const id = await registry.electionCount();
        await registry.createRevealElection(ROOT, candidateCount, start, endTime, revealEndTime);
        await time.increaseTo(start);
        return id;
    }

    // Casts one commitment ballot per entry; ballot index i holds openings[i].
    async function castAll(id: bigint, openings: Array<[number, bigint]>): Promise<void> {
        for (let i = 0; i < openings.length; i++) {
            const [vote, randomness] = openings[i];
            await ballotBox.castVotePrivate(id, 1000n + BigInt(i), commit(vote, randomness), ZERO_PROOF.a, ZERO_PROOF.b, ZERO_PROOF.c);
        }
    }

    before(async function () {
        poseidon = await circomlibjs.buildPoseidon();
    });

    beforeEach(async function () {
        registry = await (await ethers.getContractFactory("ElectionRegistry")).deploy();
        const mock = await (await ethers.getContractFactory("MockVerifier")).deploy();
        ballotBox = await (await ethers.getContractFactory("BallotBox")).deploy(
            await registry.getAddress(),
            await mock.getAddress(),
        );
        await ballotBox.setVerifierPrivate(await mock.getAddress());
        await ballotBox.setCommitmentHasher(await deployPoseidon2());
        electionId = await createRevealElection(4);
    });

    it("on-chain Poseidon(2) matches the circuit hash used for commitments", async function () {
        const hasher = await ethers.getContractAt(
            circomlibjs.poseidonContract.generateABI(2),
            await ballotBox.commitmentHasher(),
        );
        const onchain: bigint = await hasher.getFunction("poseidon(uint256[2])").staticCall([3n, 987654321n]);
        expect(onchain).to.equal(commit(3, 987654321n));
    });

    it("rejects a reveal window that does not end after voting", async function () {
        const now = await time.latest();
        await expect(
            registry.createRevealElection(ROOT, 4, now + 10, now + 100, now + 100),
        ).to.be.revertedWithCustomError(registry, "InvalidRevealWindow");
    });

    it("casts commitment ballots and rejects public ballots on a reveal election", async function () {
        await castAll(electionId, [[1, 11n]]);
        expect(await ballotBox.encryptedBallotCount(electionId)).to.equal(1n);
        await expect(
            ballotBox.castVote(electionId, 5n, 0, ZERO_PROOF.a, ZERO_PROOF.b, ZERO_PROOF.c),
        ).to.be.revertedWithCustomError(ballotBox, "WrongElectionType");
    });

    it("refuses reveals while voting is open", async function () {
        await castAll(electionId, [[1, 11n]]);
        await expect(
            ballotBox.revealVotes(electionId, [0], [1], [11n]),
        ).to.be.revertedWithCustomError(ballotBox, "RevealNotOpen");
    });

    it("counts valid openings and lets anyone reveal", async function () {
        await castAll(electionId, [[1, 11n], [3, 22n], [1, 33n]]);
        await time.increaseTo(endTime + 1);
        const [, outsider] = await ethers.getSigners();

        await expect(ballotBox.connect(outsider).revealVotes(electionId, [0, 2], [1, 1], [11n, 33n]))
            .to.emit(ballotBox, "VoteRevealed").withArgs(electionId, 0n, 1, outsider.address);

        expect(await ballotBox.revealedCounts(electionId, 1)).to.equal(2n);
        expect(await ballotBox.revealedTotal(electionId)).to.equal(2n);
        expect(await ballotBox.isBallotRevealed(electionId, 0)).to.equal(true);
        expect(await ballotBox.isBallotRevealed(electionId, 1)).to.equal(false);
        expect(await ballotBox.getResults(electionId)).to.deep.equal([0n, 2n, 0n, 0n]);
    });

    it("rejects wrong openings, out-of-range votes and indices, and malformed batches", async function () {
        await castAll(electionId, [[1, 11n], [3, 22n]]);
        await time.increaseTo(endTime + 1);

        await expect(ballotBox.revealVotes(electionId, [0], [1], [12n]))
            .to.be.revertedWithCustomError(ballotBox, "OpeningMismatch");
        await expect(ballotBox.revealVotes(electionId, [0], [2], [11n]))
            .to.be.revertedWithCustomError(ballotBox, "OpeningMismatch");
        await expect(ballotBox.revealVotes(electionId, [1], [4], [22n]))
            .to.be.revertedWithCustomError(ballotBox, "InvalidVote");
        await expect(ballotBox.revealVotes(electionId, [2], [1], [11n]))
            .to.be.revertedWithCustomError(ballotBox, "BallotIndexOutOfRange");
        await expect(ballotBox.revealVotes(electionId, [], [], []))
            .to.be.revertedWithCustomError(ballotBox, "InvalidRevealBatch");
        await expect(ballotBox.revealVotes(electionId, [0, 1], [1], [11n, 22n]))
            .to.be.revertedWithCustomError(ballotBox, "InvalidRevealBatch");
        expect(await ballotBox.revealedTotal(electionId)).to.equal(0n);
    });

    it("rejects a second reveal of the same ballot, also within one batch", async function () {
        await castAll(electionId, [[1, 11n]]);
        await time.increaseTo(endTime + 1);

        await expect(ballotBox.revealVotes(electionId, [0, 0], [1, 1], [11n, 11n]))
            .to.be.revertedWithCustomError(ballotBox, "BallotAlreadyRevealed");
        await ballotBox.revealVotes(electionId, [0], [1], [11n]);
        await expect(ballotBox.revealVotes(electionId, [0], [1], [11n]))
            .to.be.revertedWithCustomError(ballotBox, "BallotAlreadyRevealed");
    });

    it("finalizes after the deadline with the unrevealed gap, exactly once", async function () {
        await castAll(electionId, [[1, 11n], [3, 22n], [0, 44n]]);
        await time.increaseTo(endTime + 1);
        await ballotBox.revealVotes(electionId, [0, 1], [1, 3], [11n, 22n]);

        await expect(ballotBox.finalizeReveal(electionId))
            .to.be.revertedWithCustomError(ballotBox, "RevealStillOpen");
        await time.increaseTo(revealEndTime + 1);
        await expect(ballotBox.revealVotes(electionId, [2], [0], [44n]))
            .to.be.revertedWithCustomError(ballotBox, "RevealNotOpen");

        await expect(ballotBox.finalizeReveal(electionId))
            .to.emit(ballotBox, "RevealFinalized").withArgs(electionId, [0n, 1n, 0n, 1n], 2n, 1n);
        expect(await ballotBox.revealFinalized(electionId)).to.equal(true);
        await expect(ballotBox.finalizeReveal(electionId))
            .to.be.revertedWithCustomError(ballotBox, "RevealAlreadyFinalized");
    });

    it("keeps the reveal path closed to publisher-workflow and public elections", async function () {
        const now = await time.latest();
        const privateId = await registry.electionCount();
        await registry.createPrivateElection(ROOT, 4, now + 10, now + 100);
        const publicId = await registry.electionCount();
        await registry.createElection(ROOT, 4, now + 10, now + 100);
        await time.increaseTo(now + 101);

        await expect(ballotBox.revealVotes(privateId, [0], [0], [1n]))
            .to.be.revertedWithCustomError(ballotBox, "WrongElectionType");
        await expect(ballotBox.finalizeReveal(publicId))
            .to.be.revertedWithCustomError(ballotBox, "WrongElectionType");
    });

    it("lets only the deployment authority set the hasher, once", async function () {
        const [, outsider] = await ethers.getSigners();
        const fresh = await (await ethers.getContractFactory("BallotBox")).deploy(
            await registry.getAddress(),
            ethers.ZeroAddress,
        );
        const hasher = await deployPoseidon2();
        await expect(fresh.connect(outsider).setCommitmentHasher(hasher))
            .to.be.revertedWithCustomError(fresh, "UnauthorizedConfiguration");
        await fresh.setCommitmentHasher(hasher);
        await expect(fresh.setCommitmentHasher(hasher))
            .to.be.revertedWithCustomError(fresh, "HasherAlreadySet");
    });

    it("reports reveal gas for a 32-ballot election (informational)", async function () {
        const openings: Array<[number, bigint]> = Array.from({ length: 32 }, (_, i) => [i % 4, 1_000_003n * BigInt(i + 1)]);
        await castAll(electionId, openings);
        await time.increaseTo(endTime + 1);

        const single = await (await ballotBox.revealVotes(electionId, [0], [openings[0][0]], [openings[0][1]])).wait();
        const indices = Array.from({ length: 31 }, (_, i) => i + 1);
        const batch = await (await ballotBox.revealVotes(
            electionId,
            indices,
            indices.map((i) => openings[i][0]),
            indices.map((i) => openings[i][1]),
        )).wait();

        console.log(`        single-reveal tx gas: ${single!.gasUsed}`);
        console.log(`        31-ballot batch tx gas: ${batch!.gasUsed} (${batch!.gasUsed / 31n} per ballot)`);
        expect(await ballotBox.revealedTotal(electionId)).to.equal(32n);
    });
});
