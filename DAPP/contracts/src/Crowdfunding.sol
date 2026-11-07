// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Crowdfunding
/// @notice Local-demo crowdfunding with contributor-weighted release votes.
contract Crowdfunding {
    enum Status {
        Funding,
        Failed,
        Voting,
        Approved,
        Rejected,
        Released
    }

    struct Project {
        string name;
        string description;
        address payable creator;
        uint256 goal;
        uint256 raised;
        uint64 fundingDeadline;
        uint64 votingDuration;
        uint256 yesWeight;
        uint256 noWeight;
        bool withdrawn;
    }

    Project[] private _projects;
    mapping(uint256 projectId => mapping(address contributor => uint256 amount)) public contributions;
    mapping(uint256 projectId => mapping(address voter => bool hasVoted)) public hasVoted;
    mapping(uint256 projectId => mapping(address contributor => bool hasRefunded)) public hasRefunded;

    uint256 private _lock = 1;

    error InvalidProject();
    error ProjectNotFound();
    error FundingClosed();
    error FundingStillOpen();
    error FundingUnsuccessful();
    error FundingGoalNotMet();
    error VotingNotOpen();
    error VotingStillOpen();
    error NotContributor();
    error AlreadyVoted();
    error VoteAlreadyFinalized();
    error ReleaseNotApproved();
    error NotCreator();
    error AlreadyWithdrawn();
    error NothingToRefund();
    error ReentrantCall();
    error TransferFailed();

    event ProjectCreated(
        uint256 indexed projectId,
        address indexed creator,
        string name,
        uint256 goal,
        uint64 fundingDeadline,
        uint64 votingDuration
    );
    event ContributionMade(uint256 indexed projectId, address indexed contributor, uint256 amount);
    event VoteCast(uint256 indexed projectId, address indexed voter, bool support, uint256 weight);
    event FundsWithdrawn(uint256 indexed projectId, address indexed creator, uint256 amount);
    event RefundIssued(uint256 indexed projectId, address indexed contributor, uint256 amount);

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    function createProject(
        string calldata name,
        string calldata description,
        uint256 goal,
        uint64 fundingDuration,
        uint64 votingDuration
    ) external returns (uint256 projectId) {
        if (
            bytes(name).length == 0 || bytes(name).length > 80 ||
            bytes(description).length == 0 || bytes(description).length > 2000 ||
            goal == 0 || fundingDuration == 0 || votingDuration == 0
        ) revert InvalidProject();
        uint256 deadline = block.timestamp + fundingDuration;
        if (deadline > type(uint64).max) revert InvalidProject();

        projectId = _projects.length;
        _projects.push(
            Project({
                name: name,
                description: description,
                creator: payable(msg.sender),
                goal: goal,
                raised: 0,
                fundingDeadline: uint64(deadline),
                votingDuration: votingDuration,
                yesWeight: 0,
                noWeight: 0,
                withdrawn: false
            })
        );
        emit ProjectCreated(projectId, msg.sender, name, goal, uint64(deadline), votingDuration);
    }

    function contribute(uint256 projectId) external payable {
        Project storage project = _get(projectId);
        if (block.timestamp >= project.fundingDeadline) revert FundingClosed();
        if (msg.value == 0) revert InvalidProject();
        project.raised += msg.value;
        contributions[projectId][msg.sender] += msg.value;
        emit ContributionMade(projectId, msg.sender, msg.value);
    }

    function vote(uint256 projectId, bool support) external {
        Project storage project = _get(projectId);
        if (block.timestamp < project.fundingDeadline) revert VotingNotOpen();
        if (project.raised < project.goal) revert FundingUnsuccessful();
        if (block.timestamp >= uint256(project.fundingDeadline) + project.votingDuration) revert VotingNotOpen();
        uint256 weight = contributions[projectId][msg.sender];
        if (weight == 0) revert NotContributor();
        if (hasVoted[projectId][msg.sender]) revert AlreadyVoted();

        hasVoted[projectId][msg.sender] = true;
        if (support) project.yesWeight += weight;
        else project.noWeight += weight;
        emit VoteCast(projectId, msg.sender, support, weight);
    }

    function withdraw(uint256 projectId) external nonReentrant {
        Project storage project = _get(projectId);
        if (msg.sender != project.creator) revert NotCreator();
        if (project.withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp < project.fundingDeadline) revert VotingNotOpen();
        if (project.raised < project.goal) revert FundingUnsuccessful();
        uint256 voteEnds = uint256(project.fundingDeadline) + project.votingDuration;
        if (block.timestamp < voteEnds) revert VotingStillOpen();
        if (project.yesWeight <= project.raised / 2) revert ReleaseNotApproved();

        project.withdrawn = true;
        uint256 amount = project.raised;
        (bool sent,) = project.creator.call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit FundsWithdrawn(projectId, project.creator, amount);
    }

    function refund(uint256 projectId) external nonReentrant {
        Project storage project = _get(projectId);
        if (block.timestamp < project.fundingDeadline) revert FundingStillOpen();
        uint256 amount = contributions[projectId][msg.sender];
        if (amount == 0 || hasRefunded[projectId][msg.sender]) revert NothingToRefund();

        bool failed = project.raised < project.goal;
        bool voteEnded = block.timestamp >= uint256(project.fundingDeadline) + project.votingDuration;
        bool rejected = project.yesWeight <= project.raised / 2;
        if (!failed && !(voteEnded && rejected)) revert VoteAlreadyFinalized();

        hasRefunded[projectId][msg.sender] = true;
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit RefundIssued(projectId, msg.sender, amount);
    }

    function projectCount() external view returns (uint256) {
        return _projects.length;
    }

    function getProject(uint256 projectId) external view returns (Project memory) {
        return _get(projectId);
    }

    function getStatus(uint256 projectId) external view returns (Status) {
        Project storage project = _get(projectId);
        if (project.withdrawn) return Status.Released;
        if (block.timestamp < project.fundingDeadline) return Status.Funding;
        if (project.raised < project.goal) return Status.Failed;
        if (block.timestamp < uint256(project.fundingDeadline) + project.votingDuration) return Status.Voting;
        if (project.yesWeight > project.raised / 2) return Status.Approved;
        return Status.Rejected;
    }

    function votingDeadline(uint256 projectId) external view returns (uint256) {
        Project storage project = _get(projectId);
        return uint256(project.fundingDeadline) + project.votingDuration;
    }

    function _get(uint256 projectId) private view returns (Project storage project) {
        if (projectId >= _projects.length) revert ProjectNotFound();
        project = _projects[projectId];
    }
}
