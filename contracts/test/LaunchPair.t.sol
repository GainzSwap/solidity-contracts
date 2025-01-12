// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import { LaunchPair, TokenPayment } from "../LaunchPair.sol";
import { Governance } from "../Governance.sol";
import { GToken } from "../tokens/GToken/GToken.sol";

contract LaunchPairTest is Test {
	LaunchPair private launchPair;
	GToken private gToken;

	address private owner;
	address private creator = address(2);
	address private participant = address(3);

	function setUp() public {
		owner = address(new Governance());
		vm.startPrank(owner);
		gToken = new GToken();
		launchPair = new LaunchPair();
		launchPair.initialize(address(gToken));
		vm.stopPrank();
	}

	function testCreateCampaign(uint256 goal, uint256 duration) public {
		vm.assume(goal > 0);
		vm.assume(duration > 0);

		vm.startPrank(owner);
		uint256 campaignId = launchPair.createCampaign(creator);

		assertEq(launchPair.campaignCount(), campaignId);
		LaunchPair.Campaign memory campaign = launchPair.getCampaignDetails(
			campaignId
		);

		assertEq(campaign.creator, creator);
		assert(campaign.status == LaunchPair.CampaignStatus.Pending);
		vm.stopPrank();
	}

	function testStartCampaign(uint256 goal, uint256 duration) public {
		vm.assume(goal > 0);
		duration = bound(duration, 1, 30 days);

		vm.startPrank(owner);
		uint256 campaignId = launchPair.createCampaign(creator);
		vm.stopPrank();

		vm.startPrank(creator);
		launchPair.startCampaign(goal, duration, campaignId);

		LaunchPair.Campaign memory campaign = launchPair.getCampaignDetails(
			campaignId
		);
		assertEq(campaign.goal, goal);
		assertEq(campaign.deadline, block.timestamp + duration);
		assert(campaign.status == LaunchPair.CampaignStatus.Funding);
		vm.stopPrank();
	}

	function testContribute(uint256 contributionAmount) public payable {
		vm.assume(contributionAmount > 0);
		vm.deal(participant, contributionAmount);

		vm.startPrank(owner);
		uint256 campaignId = launchPair.createCampaign(creator);
		vm.stopPrank();

		vm.startPrank(creator);
		launchPair.startCampaign(1 ether, 1 days, campaignId);
		vm.stopPrank();

		vm.startPrank(participant);
		launchPair.contribute{ value: contributionAmount }(campaignId);

		uint256 userContribution = launchPair.contributions(
			campaignId,
			participant
		);
		assertEq(userContribution, contributionAmount);

		LaunchPair.Campaign memory campaign = launchPair.getCampaignDetails(
			campaignId
		);
		assertEq(campaign.fundsRaised, contributionAmount);
		vm.stopPrank();
	}

	function testWithdrawFunds(
		uint256 goal,
		uint256 contributionAmount
	) public payable {
		vm.assume(goal > 0);
		vm.assume(contributionAmount >= goal);
		vm.deal(participant, contributionAmount);

		vm.startPrank(owner);
		uint256 campaignId = launchPair.createCampaign(creator);
		vm.stopPrank();

		vm.startPrank(creator);
		launchPair.startCampaign(goal, 1 days, campaignId);
		vm.stopPrank();

		vm.startPrank(participant);
		launchPair.contribute{ value: contributionAmount }(campaignId);
		vm.stopPrank();

		vm.startPrank(owner);
		uint256 balanceBefore = owner.balance;
		launchPair.withdrawFunds(campaignId);
		uint256 balanceAfter = owner.balance;

		assertEq(balanceAfter - balanceBefore, contributionAmount);

		LaunchPair.Campaign memory campaign = launchPair.getCampaignDetails(
			campaignId
		);
		assert(campaign.status == LaunchPair.CampaignStatus.Success);
		vm.stopPrank();
	}

	// function testWithdrawLaunchPairToken(
	// 	uint256 goal,
	// 	uint256 contributionAmount
	// ) public payable {
	// 	vm.assume(goal > 0);
	// 	vm.assume(contributionAmount >= goal);
	// 	vm.deal(participant, contributionAmount);

	// 	vm.startPrank(owner);
	// 	uint256 campaignId = launchPair.createCampaign(creator);
	// 	vm.stopPrank();

	// 	vm.startPrank(creator);
	// 	launchPair.startCampaign(goal, 1 days, campaignId);
	// 	vm.stopPrank();

	// 	vm.startPrank(participant);
	// 	launchPair.contribute{ value: contributionAmount }(campaignId);
	// 	vm.stopPrank();

	// 	vm.startPrank(owner);
	// 	gToken.mint(address(launchPair), 1, 100, "");
	// 	launchPair.receiveGToken(
	// 		TokenPayment(address(gToken), 100, 1),
	// 		campaignId
	// 	);
	// 	vm.stopPrank();

	// 	vm.startPrank(participant);
	// 	launchPair.withdrawLaunchPairToken(campaignId);

	// 	LaunchPair.Campaign memory campaign = launchPair.getCampaignDetails(
	// 		campaignId
	// 	);
	// 	assert(campaign.status== LaunchPair.CampaignStatus.Success);
	// 	vm.stopPrank();
	// }

	function testRefund(
		uint256 goal,
		uint256 contributionAmount
	) public payable {
		vm.assume(goal > 0);
		vm.assume(contributionAmount > 0 && contributionAmount < goal);
		vm.deal(participant, contributionAmount);

		vm.startPrank(owner);
		uint256 campaignId = launchPair.createCampaign(creator);
		vm.stopPrank();

		vm.startPrank(creator);
		launchPair.startCampaign(goal, 1 days, campaignId);
		vm.stopPrank();

		vm.startPrank(participant);
		launchPair.contribute{ value: contributionAmount }(campaignId);
		vm.stopPrank();

		// Simulate campaign expiration
		vm.warp(block.timestamp + 2 days);

		vm.startPrank(participant);
		uint256 balanceBefore = participant.balance;
		launchPair.getRefunded(campaignId);
		uint256 balanceAfter = participant.balance;

		assertEq(balanceAfter - balanceBefore, contributionAmount);

		LaunchPair.Campaign memory campaign = launchPair.getCampaignDetails(
			campaignId
		);
		assert(campaign.status == LaunchPair.CampaignStatus.Failed);
		vm.stopPrank();
	}
}
