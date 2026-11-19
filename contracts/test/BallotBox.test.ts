import { expect } from "chai";
import { ethers } from "hardhat";
import { ElectionRegistry, BallotBox } from "../typechain-types";

describe("BallotBox", function () {
    let registry: ElectionRegistry;
    let ballotBox: BallotBox;
    let mockVerifier: any;

    const ELECTION_ID = 0;
    const CANDIDATE_COUNT = 4;
    const MOCK_ROOT = ethers.keccak256(ethers.toUtf8Bytes("mock_root"));

    beforeEach(async function () {
        // Deploy ElectionRegistry
        const ElectionRegistryFactory = await ethers.getContractFactory("ElectionRegistry");
        registry = await ElectionRegistryFactory.deploy();

        // Deploy a mock verifier that always returns true for testing
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
        mockVerifier = await MockVerifierFactory.deploy();

        // Deploy BallotBox
        const BallotBoxFactory = await ethers.getContractFactory("BallotBox");
        ballotBox = await BallotBoxFactory.deploy(
            await registry.getAddress(),
            await mockVerifier.getAddress()
        );

        // Create an election
        const now = Math.floor(Date.now() / 1000);
        await registry.createElection(
            MOCK_ROOT,
            CANDIDATE_COUNT,
            now - 60, // started 1 min ago
            now + 3600 // ends in 1 hour
        );
    });

    describe("Vote Casting", function () {
        it("accepts first valid vote", async function () {
            const nullifier = 12345n;
            const vote = 1;
            const mockProof = {
                a: [1n, 2n] as [bigint, bigint],
                b: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]],
                c: [7n, 8n] as [bigint, bigint]
            };

            await expect(
                ballotBox.castVote(
                    ELECTION_ID,
                    nullifier,
                    vote,
                    mockProof.a,
                    mockProof.b,
                    mockProof.c
                )
            ).to.emit(ballotBox, "VoteCast");

            // Check vote was counted
            const results = await ballotBox.getResults(ELECTION_ID);
            expect(results[vote]).to.equal(1n);
            expect(await ballotBox.totalVotes(ELECTION_ID)).to.equal(1n);
        });

        it("rejects duplicate nullifier", async function () {
            const nullifier = 12345n;
            const vote = 1;
            const mockProof = {
                a: [1n, 2n] as [bigint, bigint],
                b: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]],
                c: [7n, 8n] as [bigint, bigint]
            };

            // First vote should succeed
            await ballotBox.castVote(
                ELECTION_ID,
                nullifier,
                vote,
                mockProof.a,
                mockProof.b,
                mockProof.c
            );

            // Second vote with same nullifier should fail
            await expect(
                ballotBox.castVote(
                    ELECTION_ID,
                    nullifier,
                    vote,
                    mockProof.a,
                    mockProof.b,
                    mockProof.c
                )
            ).to.be.revertedWithCustomError(ballotBox, "NullifierAlreadyUsed");
        });

        it("rejects invalid vote >= candidateCount", async function () {
            const nullifier = 99999n;
            const invalidVote = CANDIDATE_COUNT; // 4 >= 4 is invalid
            const mockProof = {
                a: [1n, 2n] as [bigint, bigint],
                b: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]],
                c: [7n, 8n] as [bigint, bigint]
            };

            await expect(
                ballotBox.castVote(
                    ELECTION_ID,
                    nullifier,
                    invalidVote,
                    mockProof.a,
                    mockProof.b,
                    mockProof.c
                )
            ).to.be.revertedWithCustomError(ballotBox, "InvalidVote");
        });
    });

    describe("Results", function () {
        it("returns correct vote counts", async function () {
            const mockProof = {
                a: [1n, 2n] as [bigint, bigint],
                b: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]],
                c: [7n, 8n] as [bigint, bigint]
            };

            // Cast votes for different candidates
            await ballotBox.castVote(ELECTION_ID, 1n, 0, mockProof.a, mockProof.b, mockProof.c);
            await ballotBox.castVote(ELECTION_ID, 2n, 1, mockProof.a, mockProof.b, mockProof.c);
            await ballotBox.castVote(ELECTION_ID, 3n, 1, mockProof.a, mockProof.b, mockProof.c);
            await ballotBox.castVote(ELECTION_ID, 4n, 2, mockProof.a, mockProof.b, mockProof.c);

            const results = await ballotBox.getResults(ELECTION_ID);
            expect(results[0]).to.equal(1n); // Candidate 0: 1 vote
            expect(results[1]).to.equal(2n); // Candidate 1: 2 votes
            expect(results[2]).to.equal(1n); // Candidate 2: 1 vote
            expect(results[3]).to.equal(0n); // Candidate 3: 0 votes
        });
    });
});

describe("ElectionRegistry", function () {
    let registry: ElectionRegistry;

    beforeEach(async function () {
        const ElectionRegistryFactory = await ethers.getContractFactory("ElectionRegistry");
        registry = await ElectionRegistryFactory.deploy();
    });

    it("creates election with valid parameters", async function () {
        const root = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
        const now = Math.floor(Date.now() / 1000);

        await expect(
            registry.createElection(root, 4, now, now + 3600)
        ).to.emit(registry, "ElectionCreated");

        expect(await registry.electionCount()).to.equal(1n);
    });

    it("rejects invalid candidate count", async function () {
        const root = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
        const now = Math.floor(Date.now() / 1000);

        await expect(
            registry.createElection(root, 0, now, now + 3600)
        ).to.be.revertedWithCustomError(registry, "InvalidCandidateCount");

        await expect(
            registry.createElection(root, 17, now, now + 3600)
        ).to.be.revertedWithCustomError(registry, "InvalidCandidateCount");
    });

    it("rejects invalid time range", async function () {
        const root = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
        const now = Math.floor(Date.now() / 1000);

        await expect(
            registry.createElection(root, 4, now + 3600, now)
        ).to.be.revertedWithCustomError(registry, "InvalidTimeRange");
    });
});
