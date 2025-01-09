// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import { GToken, Epochs, LiquidityInfo, GTokenBalance, GTokenLib } from "../tokens/GToken/GToken.sol";

contract GTokenTest is Test {
	using GTokenLib for GTokenLib.Attributes;
	using Epochs for Epochs.Storage;

	GToken private gToken;
	Epochs.Storage private epochs;
	address private owner = address(1);
	address private user = address(2);

	function setUp() public {
		vm.startPrank(owner);
		epochs = Epochs.Storage({
			genesis: block.timestamp,
			epochLength: 1 days
		});
		gToken = new GToken();
		gToken.initialize(epochs, owner);
		vm.stopPrank();

		vm.warp(block.timestamp + 181 days);
	}

	function testMintGToken(
		uint256 rewardPerShare,
		uint256 epochsLocked,
		uint256 currentEpoch,
		uint256 liquidity,
		uint256 liqValue
	) public {
		vm.assume(epochsLocked <= 1080);
		vm.assume(liquidity > 0 && liquidity < (type(uint256).max / 1080));
		vm.assume(liqValue > 0 && liqValue < (type(uint256).max / 1080));

		LiquidityInfo memory lpDetails = LiquidityInfo({
			token0: address(this),
			token1: user,
			liquidity: liquidity,
			liqValue: liqValue,
			pair: address(this)
		});

		vm.startPrank(owner);
		uint256 tokenId = gToken.mintGToken(
			user,
			rewardPerShare,
			epochsLocked,
			currentEpoch,
			lpDetails
		);
		vm.stopPrank();

		GTokenBalance memory balance = gToken.getBalanceAt(user, tokenId);
		assertEq(balance.attributes.rewardPerShare, rewardPerShare);
		assertEq(balance.attributes.epochsLocked, epochsLocked);
		assertEq(balance.attributes.lpDetails.liquidity, liquidity);
	}

	function testUpdate(
		uint256 rewardPerShare,
		uint256 epochsLocked,
		uint256 liquidity,
		uint112 liqValue
	) public {
		vm.assume(epochsLocked <= 1080);
		vm.assume(liquidity < (type(uint256).max / 1080));
		vm.assume(rewardPerShare < (type(uint256).max / 2));

		LiquidityInfo memory lpDetails = LiquidityInfo({
			token0: address(this),
			token1: user,
			liquidity: liquidity,
			liqValue: liqValue,
			pair: address(this)
		});

		vm.startPrank(owner);
		uint256 tokenId = gToken.mintGToken(
			user,
			rewardPerShare,
			epochsLocked,
			0,
			lpDetails
		);
		vm.stopPrank();

		GTokenLib.Attributes memory updatedAttributes = GTokenLib
			.Attributes({
				rewardPerShare: rewardPerShare + 1,
				epochStaked: 1,
				lastClaimEpoch: 1,
				epochsLocked: epochsLocked,
				stakeWeight: 0,
				lpDetails: lpDetails
			})
			.computeStakeWeight(epochs.currentEpoch());

		vm.startPrank(owner);
		uint256 newTokenId = gToken.update(user, tokenId, updatedAttributes);
		vm.stopPrank();

		if (newTokenId > 0) {
			GTokenBalance memory balance = gToken.getBalanceAt(
				user,
				newTokenId
			);
			assertEq(
				balance.attributes.rewardPerShare,
				updatedAttributes.rewardPerShare
			);
			assertEq(
				balance.attributes.lpDetails.liqValue,
				updatedAttributes.lpDetails.liqValue
			);
		}
	}

	function testSplit(uint256 liquidity, uint112 liqValue) public {
		vm.assume(liquidity > 0 );
		vm.assume(liqValue > 0 );

		LiquidityInfo memory lpDetails = LiquidityInfo({
			token0: address(this),
			token1: user,
			liquidity: liquidity,
			liqValue: liqValue,
			pair: address(this)
		});

		vm.startPrank(owner);
		uint256 tokenId = gToken.mintGToken(user, 1, 100, 0, lpDetails);
		vm.stopPrank();

		address[] memory addresses = new address[](2);
		addresses[0] = user;
		addresses[1] = address(3);

		uint256[] memory portions = new uint256[](2);
		portions[0] = lpDetails.liquidity / 2;
		portions[1] = lpDetails.liquidity / 2;

		vm.startPrank(owner);
		uint256[] memory splitTokenIds = gToken.split(
			tokenId,
			addresses,
			portions
		);
		vm.stopPrank();

		uint256 portionLiquiditySum = 0;
		uint256 portionLiquidityValueSum = 0;
		for (uint256 i = 0; i < splitTokenIds.length; i++) {
			GTokenBalance memory balance = gToken.getBalanceAt(
				addresses[i],
				splitTokenIds[i]
			);
			portionLiquidityValueSum += balance.amount;
			portionLiquiditySum += balance.attributes.lpDetails.liquidity;
		}

		assertEq(
			portionLiquidityValueSum,
			lpDetails.liqValue,
			"Liquidity Value"
		);
		assertEq(portionLiquiditySum, lpDetails.liquidity, "Liquidity");
	}

	function testEpochCalculations() public {
		uint256 currentEpoch = epochs.currentEpoch();
		assertEq(currentEpoch, 181);

		// Simulate passage of time
		vm.warp(block.timestamp + 2 days);
		currentEpoch = epochs.currentEpoch();
		assertEq(currentEpoch, 183);
	}

	function testTotalStakeWeight(
		uint256 rewardPerShare,
		uint256 epochsLocked,
		uint256 liquidity,
		uint112 liqValue
	) public {
		vm.assume(epochsLocked <= 1080);
		vm.assume(liquidity > 0 && liquidity < type(uint256).max / 1080);

		LiquidityInfo memory lpDetails = LiquidityInfo({
			token0: address(this),
			token1: user,
			liquidity: liquidity,
			liqValue: liqValue,
			pair: address(this)
		});

		vm.startPrank(owner);
		gToken.mintGToken(user, rewardPerShare, epochsLocked, 0, lpDetails);
		vm.stopPrank();

		assertEq(
			gToken.totalStakeWeight(),
			gToken.getBalanceAt(user, 1).attributes.stakeWeight
		);
	}
}
