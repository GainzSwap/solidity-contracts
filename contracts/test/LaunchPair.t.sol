// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "forge-std/console.sol";

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { LaunchPair, TokenPayment } from "../LaunchPair.sol";
import { Governance, Epochs } from "../Governance.sol";
import { GToken, LiquidityInfo } from "../tokens/GToken/GToken.sol";
import { RouterFixture, Gainz } from "./shared/RouterFixture.sol";

contract LaunchPairTest is Test, RouterFixture {
	LaunchPair private launchPair;
	GToken private gToken;

	address private owner;
	address private creator = address(2);
	address private participant = address(3);

	function setUp() public {
		Governance gov = Governance(payable(router.getGovernance()));
		owner = address(gov);
		gToken = GToken(gov.getGToken());
		launchPair = gov.launchPair();

		router.setFeeTo(address(launchPair));
	}

	function testOnlyOwnerCanCreateCampaign() public {
		vm.startPrank(creator);
		vm.expectPartialRevert(
			OwnableUpgradeable.OwnableUnauthorizedAccount.selector
		);
		launchPair.createCampaign(creator);
		vm.stopPrank();
	}

	function testCreateCampaign(uint256 goal, uint256 duration) public {
		vm.assume(goal > 50_000 ether);
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
		vm.assume(goal > 50_000 ether);
		duration = bound(duration, 7 days, 30 days);

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
		vm.assume(contributionAmount > 1 ether);
		vm.deal(participant, contributionAmount);

		vm.startPrank(owner);
		uint256 campaignId = launchPair.createCampaign(creator);
		vm.stopPrank();

		vm.startPrank(creator);
		launchPair.startCampaign(50_000 ether, 7 days, campaignId);
		vm.stopPrank();

		vm.startPrank(participant);
		launchPair.contribute{ value: contributionAmount }(campaignId, 0);

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
		vm.assume(goal > 50_000 ether);
		vm.assume(contributionAmount >= goal);
		vm.deal(participant, contributionAmount);

		vm.startPrank(owner);
		uint256 campaignId = launchPair.createCampaign(creator);
		vm.stopPrank();

		vm.startPrank(creator);
		launchPair.startCampaign(goal, 7 days, campaignId);
		vm.stopPrank();

		vm.startPrank(participant);
		launchPair.contribute{ value: contributionAmount }(campaignId, 0);
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

	function testWithdrawLaunchPairToken(
		uint256 goal,
		LiquidityInfo memory lpDetails
	) public payable {
		vm.assume(goal > 50_000 ether && goal <= 1_000_000_000 ether);
		uint256 contributionAmount = goal;

		vm.deal(participant, contributionAmount);

		vm.startPrank(owner);
		uint256 campaignId = launchPair.createCampaign(creator);
		vm.stopPrank();

		vm.startPrank(creator);
		launchPair.startCampaign(goal, 7 days, campaignId);
		vm.stopPrank();

		vm.startPrank(participant);
		launchPair.contribute{ value: contributionAmount }(campaignId, 0);
		vm.stopPrank();

		vm.startPrank(owner);
		launchPair.withdrawFunds(campaignId);
		lpDetails.liqValue = contributionAmount;
		lpDetails.liquidity = contributionAmount;
		gToken.mintGToken(owner, 1, 1080, lpDetails);
		gToken.setApprovalForAll(address(launchPair), true);
		launchPair.receiveGToken(
			TokenPayment(address(gToken), lpDetails.liqValue, 1),
			campaignId
		);
		vm.stopPrank();

		vm.startPrank(participant);
		vm.warp(block.timestamp + 3 days);
		uint256 participantGTokenNonce = launchPair.withdrawLaunchPairToken(
			campaignId
		);

		LaunchPair.Campaign memory campaign = launchPair.getCampaignDetails(
			campaignId
		);
		assert(campaign.status == LaunchPair.CampaignStatus.Success);
		assertTrue(gToken.hasSFT(participant, participantGTokenNonce));
		vm.stopPrank();
	}

	function testRefund(
		uint256 goal,
		uint256 contributionAmount
	) public payable {
		vm.assume(goal > 50_000 ether);
		vm.assume(contributionAmount > 1 ether && contributionAmount < goal);
		vm.deal(participant, contributionAmount);

		vm.startPrank(owner);
		uint256 campaignId = launchPair.createCampaign(creator);
		vm.stopPrank();

		vm.startPrank(creator);
		launchPair.startCampaign(goal, 7 days, campaignId);
		vm.stopPrank();

		vm.startPrank(participant);
		launchPair.contribute{ value: contributionAmount }(campaignId, 0);
		vm.stopPrank();

		// Simulate campaign expiration
		vm.warp(block.timestamp + 20 days);

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
