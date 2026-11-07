// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Crowdfunding} from "../src/Crowdfunding.sol";
import {TestBase} from "./TestBase.sol";

contract ReentrantCreator {
    Crowdfunding public immutable crowdfunding;
    uint256 public projectId;
    bool public attempted;

    constructor(Crowdfunding crowdfunding_) { crowdfunding = crowdfunding_; }

    function createAndFund() external payable {
        projectId = crowdfunding.createProject("Reentry", "test", 1 ether, 1 days, 1 days);
        crowdfunding.contribute{value: 1 ether}(projectId);
    }

    function tryWithdraw() external {
        crowdfunding.withdraw(projectId);
    }

    receive() external payable {
        if (!attempted) {
            attempted = true;
            try crowdfunding.withdraw(projectId) {} catch {}
        }
    }
}

contract CrowdfundingTest is TestBase {
    Crowdfunding private crowdfunding;
    address private creator = makeAddr("creator");
    address private alice = makeAddr("alice");
    address private bob = makeAddr("bob");
    address private stranger = makeAddr("stranger");

    function setUp() public {
        crowdfunding = new Crowdfunding();
        vm.deal(creator, 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(stranger, 100 ether);
    }

    function _create(uint256 goal, uint64 funding, uint64 voting) private returns (uint256 id) {
        vm.prank(creator);
        id = crowdfunding.createProject("Course project", "A local demo", goal, funding, voting);
    }

    function _advanceFunding(uint256 id) private {
        Crowdfunding.Project memory project = crowdfunding.getProject(id);
        vm.warp(project.fundingDeadline);
    }

    function testCreateProject() public {
        uint256 id = _create(4 ether, 3 days, 1 days);
        Crowdfunding.Project memory project = crowdfunding.getProject(id);
        assertEq(project.name, "Course project");
        assertEq(project.description, "A local demo");
        assertEq(project.creator, creator);
        assertEq(project.goal, 4 ether);
        assertEq(uint256(crowdfunding.getStatus(id)), uint256(Crowdfunding.Status.Funding));
    }

    function testContributionsAccumulate() public {
        uint256 id = _create(3 ether, 1 days, 1 days);
        vm.prank(alice);
        crowdfunding.contribute{value: 1 ether}(id);
        vm.prank(alice);
        crowdfunding.contribute{value: 2 ether}(id);
        assertEq(crowdfunding.contributions(id, alice), 3 ether);
        assertEq(crowdfunding.getProject(id).raised, 3 ether);
    }

    function testRefundAfterFailedFunding() public {
        uint256 id = _create(5 ether, 1 days, 1 days);
        vm.prank(alice);
        crowdfunding.contribute{value: 1 ether}(id);
        uint256 beforeBalance = alice.balance;
        _advanceFunding(id);
        vm.prank(alice);
        crowdfunding.refund(id);
        assertEq(alice.balance, beforeBalance + 1 ether);
        assertTrue(crowdfunding.hasRefunded(id, alice));
        assertEq(uint256(crowdfunding.getStatus(id)), uint256(Crowdfunding.Status.Failed));
    }

    function testSuccessfulFundingEntersVoting() public {
        uint256 id = _create(2 ether, 1 days, 1 days);
        vm.prank(alice);
        crowdfunding.contribute{value: 2 ether}(id);
        _advanceFunding(id);
        assertEq(uint256(crowdfunding.getStatus(id)), uint256(Crowdfunding.Status.Voting));
        vm.prank(alice);
        crowdfunding.vote(id, true);
        assertEq(crowdfunding.getProject(id).yesWeight, 2 ether);
    }

    function testNonContributorCannotVote() public {
        uint256 id = _create(1 ether, 1 days, 1 days);
        vm.prank(alice);
        crowdfunding.contribute{value: 1 ether}(id);
        _advanceFunding(id);
        vm.prank(stranger);
        vm.expectRevert(Crowdfunding.NotContributor.selector);
        crowdfunding.vote(id, true);
    }

    function testCannotVoteTwice() public {
        uint256 id = _create(1 ether, 1 days, 1 days);
        vm.prank(alice);
        crowdfunding.contribute{value: 1 ether}(id);
        _advanceFunding(id);
        vm.prank(alice);
        crowdfunding.vote(id, true);
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.AlreadyVoted.selector);
        crowdfunding.vote(id, false);
    }

    function testApprovedVoteAllowsWithdrawal() public {
        uint256 id = _create(2 ether, 1 days, 1 days);
        vm.prank(alice);
        crowdfunding.contribute{value: 2 ether}(id);
        _advanceFunding(id);
        vm.prank(alice);
        crowdfunding.vote(id, true);
        vm.prank(creator);
        vm.expectRevert(Crowdfunding.VotingStillOpen.selector);
        crowdfunding.withdraw(id);
        vm.warp(crowdfunding.votingDeadline(id));
        uint256 beforeBalance = creator.balance;
        vm.prank(creator);
        crowdfunding.withdraw(id);
        assertEq(creator.balance, beforeBalance + 2 ether);
        assertEq(uint256(crowdfunding.getStatus(id)), uint256(Crowdfunding.Status.Released));
    }

    function testRejectedVoteBlocksWithdrawal() public {
        uint256 id = _create(2 ether, 1 days, 1 days);
        vm.prank(alice);
        crowdfunding.contribute{value: 1 ether}(id);
        vm.prank(bob);
        crowdfunding.contribute{value: 1 ether}(id);
        _advanceFunding(id);
        vm.prank(alice);
        crowdfunding.vote(id, true);
        vm.prank(bob);
        crowdfunding.vote(id, false);
        vm.warp(crowdfunding.votingDeadline(id));
        vm.prank(creator);
        vm.expectRevert(Crowdfunding.ReleaseNotApproved.selector);
        crowdfunding.withdraw(id);
        assertEq(uint256(crowdfunding.getStatus(id)), uint256(Crowdfunding.Status.Rejected));
        vm.prank(alice);
        crowdfunding.refund(id);
        vm.prank(bob);
        crowdfunding.refund(id);
        assertEq(address(crowdfunding).balance, 0);
    }

    function testRefundAndWithdrawalCannotRepeat() public {
        uint256 failed = _create(3 ether, 1 days, 1 days);
        vm.prank(alice);
        crowdfunding.contribute{value: 1 ether}(failed);
        _advanceFunding(failed);
        vm.prank(alice);
        crowdfunding.refund(failed);
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.NothingToRefund.selector);
        crowdfunding.refund(failed);

        uint256 passed = _create(1 ether, 1 days, 1 days);
        vm.prank(alice);
        crowdfunding.contribute{value: 1 ether}(passed);
        _advanceFunding(passed);
        vm.prank(alice);
        crowdfunding.vote(passed, true);
        vm.warp(crowdfunding.votingDeadline(passed));
        vm.prank(creator);
        crowdfunding.withdraw(passed);
        vm.prank(creator);
        vm.expectRevert(Crowdfunding.AlreadyWithdrawn.selector);
        crowdfunding.withdraw(passed);
    }

    function testFundingDeadlineBoundaryIsClosed() public {
        uint256 id = _create(1 ether, 1 days, 1 days);
        _advanceFunding(id);
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.FundingClosed.selector);
        crowdfunding.contribute{value: 1 ether}(id);
        assertEq(uint256(crowdfunding.getStatus(id)), uint256(Crowdfunding.Status.Failed));
    }

    function testIndependentProjectsRunInParallel() public {
        uint256 first = _create(2 ether, 1 days, 1 days);
        uint256 second = _create(10 ether, 3 days, 2 days);
        vm.prank(alice);
        crowdfunding.contribute{value: 2 ether}(first);
        vm.prank(bob);
        crowdfunding.contribute{value: 3 ether}(second);
        _advanceFunding(first);
        assertEq(uint256(crowdfunding.getStatus(first)), uint256(Crowdfunding.Status.Voting));
        assertEq(uint256(crowdfunding.getStatus(second)), uint256(Crowdfunding.Status.Funding));
        assertEq(crowdfunding.getProject(first).raised, 2 ether);
        assertEq(crowdfunding.getProject(second).raised, 3 ether);
    }

    function testReentrantCreatorCannotWithdrawTwice() public {
        ReentrantCreator attacker = new ReentrantCreator(crowdfunding);
        vm.deal(address(attacker), 0);
        attacker.createAndFund{value: 1 ether}();
        uint256 id = attacker.projectId();
        _advanceFunding(id);
        // The contract is the only contributor and can vote as itself through a helper call.
        vm.prank(address(attacker));
        crowdfunding.vote(id, true);
        vm.warp(crowdfunding.votingDeadline(id));
        attacker.tryWithdraw();
        assertTrue(attacker.attempted());
        assertEq(address(attacker).balance, 1 ether);
        assertEq(address(crowdfunding).balance, 0);
    }
}
