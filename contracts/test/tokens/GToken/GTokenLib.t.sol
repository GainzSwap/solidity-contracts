// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import { GTokenLib, LiquidityInfo } from "../../../tokens/GToken/GTokenLib.sol";

contract GTokenLibFuzzTest is Test {
	using GTokenLib for GTokenLib.Attributes;

	// Fuzz test for `computeStakeWeight`
	function testComputeStakeWeight(
		uint256 liqValue,
		uint256 epochsLocked
	) public pure {
		epochsLocked = bound(
			epochsLocked,
			GTokenLib.MIN_EPOCHS_LOCK,
			GTokenLib.MAX_EPOCHS_LOCK
		);
		liqValue = bound(
			liqValue,
			0,
			type(uint256).max / GTokenLib.MAX_EPOCHS_LOCK
		);

		GTokenLib.Attributes memory attributes = _createAttributes(
			liqValue,
			epochsLocked
		);
		attributes.lpDetails.liquidity = liqValue;

		uint256 currentEpoch = 5;
		attributes = attributes.computeStakeWeight(currentEpoch);

		assertEq(
			attributes.stakeWeight,
			liqValue * (1 + attributes.epochsLeft(currentEpoch)),
			"Incorrect stake weight"
		);
	}

	// Fuzz test for `split`
	function testSplit(uint256[] memory liquidityPortions) public pure {
		vm.assume(
			liquidityPortions.length > 1 && liquidityPortions.length < 20
		);
		uint256 liquidity;
		for (uint256 i = 0; i < liquidityPortions.length; i++) {
			liquidityPortions[i] = bound(
				liquidityPortions[i],
				1,
				1_000_000_000_000_000 ether
			);
			liquidity += liquidityPortions[i];
		}

		uint256 liqValue = liquidity;
		GTokenLib.Attributes memory attributes = _createAttributes(liqValue, 0);
		attributes.lpDetails.liquidity = liquidity;

		GTokenLib.Attributes[] memory splits = attributes.split(
			liquidityPortions
		);

		uint256 totalLiquidity;
		uint256 totalLiqValue;
		for (uint256 i = 0; i < splits.length; i++) {
			totalLiquidity += splits[i].lpDetails.liquidity;
			totalLiqValue += splits[i].lpDetails.liqValue;
		}

		assertEq(totalLiquidity, liquidity, "Liquidity mismatch");
		assertEq(totalLiqValue, liqValue, "LiqValue mismatch");
	}

	// Fuzz test for `supply`
	function testSupply(uint256 liqValue) public pure {
		GTokenLib.Attributes memory attributes = _createAttributes(liqValue, 1);

		uint256 supply = attributes.supply();

		assertEq(supply, liqValue, "Supply mismatch");
	}

	// Fuzz test for `epochsElapsed`
	function testEpochsElapsed(
		uint256 epochStaked,
		uint256 currentEpoch
	) public pure {
		GTokenLib.Attributes memory attributes = _createAttributes(1, 1);
		attributes.epochStaked = epochStaked;

		currentEpoch = bound(currentEpoch, epochStaked, type(uint256).max);

		uint256 elapsed = attributes.epochsElapsed(currentEpoch);

		assertEq(
			elapsed,
			currentEpoch - epochStaked,
			"Epochs elapsed mismatch"
		);
	}

	// Fuzz test for `epochsLeft`
	function testEpochsLeft(
		uint256 epochStaked,
		uint256 epochsLocked,
		uint256 currentEpoch
	) public pure {
		epochsLocked = bound(
			epochsLocked,
			GTokenLib.MIN_EPOCHS_LOCK,
			GTokenLib.MAX_EPOCHS_LOCK
		);
		vm.assume(currentEpoch >= epochStaked);

		GTokenLib.Attributes memory attributes = _createAttributes(
			1,
			epochsLocked
		);
		attributes.epochStaked = epochStaked;

		uint256 epochsElapsed = attributes.epochsElapsed(currentEpoch);
		uint256 epochsLeft = attributes.epochsLeft(currentEpoch);

		assertEq(
			epochsLeft,
			epochsLocked > epochsElapsed ? epochsLocked - epochsElapsed : 0,
			"Epochs left mismatch"
		);
	}

	// Fuzz test for `votePower`
	function testVotePower(
		uint256 liqValue,
		uint256 epochStaked,
		uint256 epochsLocked,
		uint256 currentEpoch
	) public pure {}

	// Fuzz test for `epochsUnclaimed`
	function testEpochsUnclaimed(
		uint256 epochsLocked,
		uint256 lastClaimEpoch
	) public pure {
		epochsLocked = bound(
			epochsLocked,
			GTokenLib.MIN_EPOCHS_LOCK,
			GTokenLib.MAX_EPOCHS_LOCK
		);

		GTokenLib.Attributes memory attributes = _createAttributes(
			1,
			epochsLocked
		);
		attributes.lastClaimEpoch = lastClaimEpoch = bound(
			lastClaimEpoch,
			0,
			epochsLocked
		);

		uint256 unclaimed = attributes.epochsUnclaimed();
		assertEq(
			unclaimed,
			epochsLocked - lastClaimEpoch,
			"Epochs unclaimed mismatch"
		);
	}

	// Fuzz test for `valueToKeep`
	function testFuzzValueToKeep(
		uint256 epochsLocked,
		uint256 currentEpoch
	) public pure {
		epochsLocked = bound(epochsLocked, 1, GTokenLib.MAX_EPOCHS_LOCK);
		currentEpoch = bound(currentEpoch, 0, epochsLocked - 1);

		GTokenLib.Attributes memory attributes = _createAttributes(
			0,
			epochsLocked
		);

		uint256 testValue = 100;
		uint256 valueToKeep = attributes.valueToKeep(testValue, currentEpoch);

		// Ensure the result is within reasonable bounds
		assertLt(valueToKeep, testValue, "Value to keep exceeds input value");
	}

	// Helper function to create an Attributes struct
	function _createAttributes(
		uint256 liqValue,
		uint256 epochsLocked
	) internal pure returns (GTokenLib.Attributes memory) {
		return
			GTokenLib.Attributes({
				rewardPerShare: 0,
				epochStaked: 0,
				epochsLocked: epochsLocked,
				lastClaimEpoch: 0,
				stakeWeight: 0,
				lpDetails: LiquidityInfo({
					token0: address(0),
					token1: address(0),
					pair: address(0),
					liquidity: 1,
					liqValue: liqValue
				})
			});
	}
}
