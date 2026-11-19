// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ElectionRegistry
 * @notice Manages election metadata and configuration for both public and private modes
 */
contract ElectionRegistry {
    /// @notice Election type enum
    // PRIVATE_ENCRYPTED is a historical identifier retained for compatibility;
    // the stored object is a Poseidon hash commitment, not ciphertext. It names
    // the commitment workflow whose result is published by a configured actor.
    // COMMITMENT_REVEAL casts the same commitments but derives the result from
    // openings that the contract checks on-chain after voting closes.
    enum ElectionType { BASELINE_PUBLIC, PRIVATE_ENCRYPTED, COMMITMENT_REVEAL }

    struct Election {
        bytes32 root;           // Merkle root of eligible voters
        uint16 candidateCount;  // Number of candidates
        uint64 startTime;       // Voting start time
        uint64 endTime;         // Voting end time
        bool active;            // Whether election is active
        address creator;        // Election creator
        ElectionType electionType; // Type of election
        uint64 revealEndTime;   // Last reveal timestamp (COMMITMENT_REVEAL only, otherwise 0)
    }

    uint256 private _electionCounter;
    mapping(uint256 => Election) private _elections;
    // Commitment elections have one explicit result-publishing authority. The
    // creator is assigned at creation and may reassign the role before voting
    // starts. Public elections deliberately have no separate result publisher.
    mapping(uint256 => address) private _resultPublishers;

    event ElectionCreated(
        uint256 indexed electionId,
        bytes32 indexed root,
        uint16 candidateCount,
        uint64 startTime,
        uint64 endTime,
        address creator,
        ElectionType electionType,
        uint64 revealEndTime
    );

    event ElectionDeactivated(uint256 indexed electionId);
    event ResultPublisherAssigned(
        uint256 indexed electionId,
        address indexed publisher,
        address indexed assigner
    );

    error InvalidCandidateCount();
    error InvalidTimeRange();
    error ElectionNotFound();
    error Unauthorized();
    error InvalidRevealWindow();
    error WrongElectionType();
    error InvalidResultPublisher();
    error PublisherAssignmentClosed();

    /**
     * @notice Create a new baseline (public vote) election
     * @param root Merkle root of eligible voter commitments
     * @param candidateCount Number of candidates (1-16)
     * @param startTime Voting start timestamp
     * @param endTime Voting end timestamp
     * @return electionId The new election's ID
     */
    function createElection(
        bytes32 root,
        uint16 candidateCount,
        uint64 startTime,
        uint64 endTime
    ) external returns (uint256 electionId) {
        return _createElection(
            root,
            candidateCount,
            startTime,
            endTime,
            ElectionType.BASELINE_PUBLIC,
            0
        );
    }

    /**
     * @notice Create a commitment election whose result a configured actor publishes
     * @param root Merkle root of eligible voter commitments
     * @param candidateCount Number of candidates (1-16)
     * @param startTime Voting start timestamp
     * @param endTime Voting end timestamp
     * @return electionId The new election's ID
     */
    function createPrivateElection(
        bytes32 root,
        uint16 candidateCount,
        uint64 startTime,
        uint64 endTime
    ) external returns (uint256 electionId) {
        return _createElection(
            root,
            candidateCount,
            startTime,
            endTime,
            ElectionType.PRIVATE_ENCRYPTED,
            0
        );
    }

    /**
     * @notice Create a commitment election whose result is derived from on-chain reveals
     * @param root Merkle root of eligible voter commitments
     * @param candidateCount Number of candidates (1-16)
     * @param startTime Voting start timestamp
     * @param endTime Voting end timestamp
     * @param revealEndTime Last timestamp at which openings may be revealed (after endTime)
     * @return electionId The new election's ID
     */
    function createRevealElection(
        bytes32 root,
        uint16 candidateCount,
        uint64 startTime,
        uint64 endTime,
        uint64 revealEndTime
    ) external returns (uint256 electionId) {
        if (revealEndTime <= endTime) {
            revert InvalidRevealWindow();
        }
        return _createElection(
            root,
            candidateCount,
            startTime,
            endTime,
            ElectionType.COMMITMENT_REVEAL,
            revealEndTime
        );
    }

    /**
     * @notice Internal function to create an election
     */
    function _createElection(
        bytes32 root,
        uint16 candidateCount,
        uint64 startTime,
        uint64 endTime,
        ElectionType electionType,
        uint64 revealEndTime
    ) internal returns (uint256 electionId) {
        if (candidateCount == 0 || candidateCount > 16) {
            revert InvalidCandidateCount();
        }
        if (startTime >= endTime) {
            revert InvalidTimeRange();
        }

        electionId = _electionCounter++;
        
        _elections[electionId] = Election({
            root: root,
            candidateCount: candidateCount,
            startTime: startTime,
            endTime: endTime,
            active: true,
            creator: msg.sender,
            electionType: electionType,
            revealEndTime: revealEndTime
        });

        if (electionType == ElectionType.PRIVATE_ENCRYPTED) {
            _resultPublishers[electionId] = msg.sender;
        }

        emit ElectionCreated(
            electionId,
            root,
            candidateCount,
            startTime,
            endTime,
            msg.sender,
            electionType,
            revealEndTime
        );

        if (electionType == ElectionType.PRIVATE_ENCRYPTED) {
            emit ResultPublisherAssigned(electionId, msg.sender, msg.sender);
        }
    }

    /**
     * @notice Reassign the commitment-result publisher before voting starts.
     * @dev The role governs publication and finalization only; it does not
     *      establish tally correctness. Public elections have no such role.
     */
    function setResultPublisher(uint256 electionId, address publisher) external {
        Election storage election = _elections[electionId];
        if (election.candidateCount == 0) {
            revert ElectionNotFound();
        }
        if (election.electionType != ElectionType.PRIVATE_ENCRYPTED) {
            revert WrongElectionType();
        }
        if (election.creator != msg.sender) {
            revert Unauthorized();
        }
        if (block.timestamp >= election.startTime) {
            revert PublisherAssignmentClosed();
        }
        if (publisher == address(0)) {
            revert InvalidResultPublisher();
        }

        _resultPublishers[electionId] = publisher;
        emit ResultPublisherAssigned(electionId, publisher, msg.sender);
    }

    /**
     * @notice Deactivate an election (only creator)
     * @param electionId The election to deactivate
     */
    function deactivateElection(uint256 electionId) external {
        Election storage election = _elections[electionId];
        if (election.candidateCount == 0) {
            revert ElectionNotFound();
        }
        if (election.creator != msg.sender) {
            revert Unauthorized();
        }
        election.active = false;
        emit ElectionDeactivated(electionId);
    }

    /**
     * @notice Get election details (basic - backward compatible)
     */
    function getElection(uint256 electionId) 
        external 
        view 
        returns (
            bytes32 root,
            uint16 candidateCount,
            uint64 startTime,
            uint64 endTime,
            bool active
        ) 
    {
        Election storage election = _elections[electionId];
        return (
            election.root,
            election.candidateCount,
            election.startTime,
            election.endTime,
            election.active
        );
    }

    /**
     * @notice Get full election details including type and reveal deadline
     */
    function getElectionFull(uint256 electionId)
        external
        view
        returns (
            bytes32 root,
            uint16 candidateCount,
            uint64 startTime,
            uint64 endTime,
            bool active,
            ElectionType electionType,
            uint64 revealEndTime
        )
    {
        Election storage election = _elections[electionId];
        return (
            election.root,
            election.candidateCount,
            election.startTime,
            election.endTime,
            election.active,
            election.electionType,
            election.revealEndTime
        );
    }

    /**
     * @notice Check if voting is currently open for an election
     */
    function isVotingOpen(uint256 electionId) external view returns (bool isOpen) {
        Election storage election = _elections[electionId];
        return election.active && 
               block.timestamp >= election.startTime && 
               block.timestamp <= election.endTime;
    }

    /**
     * @notice Check if an election is private commitment-based
     */
    function isPrivateElection(uint256 electionId) external view returns (bool) {
        return _elections[electionId].electionType == ElectionType.PRIVATE_ENCRYPTED;
    }

    /**
     * @notice Check if an election accepts commitment ballots (either commitment workflow)
     */
    function isCommitmentElection(uint256 electionId) external view returns (bool) {
        ElectionType electionType = _elections[electionId].electionType;
        return electionType == ElectionType.PRIVATE_ENCRYPTED ||
               electionType == ElectionType.COMMITMENT_REVEAL;
    }

    /**
     * @notice Return the configured commitment-result publisher.
     * @dev Returns address(0) for a public election. The result publisher is an
     *      accountable actor, not a cryptographic correctness guarantee.
     */
    function getResultPublisher(uint256 electionId) external view returns (address) {
        Election storage election = _elections[electionId];
        if (election.candidateCount == 0) {
            revert ElectionNotFound();
        }
        return _resultPublishers[electionId];
    }

    /**
     * @notice Get the current election count
     */
    function electionCount() external view returns (uint256 count) {
        return _electionCounter;
    }
}
