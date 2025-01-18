// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import { GTokenLib, LiquidityInfo } from "../tokens/GToken/GTokenLib.sol";

contract GTokenLibFuzzTest is Test {
	using GTokenLib for GTokenLib.Attributes;

	// Fuzz test for `computeStakeWeight`
	function testComputeStakeWeight(
		uint256 liqValue,
		uint256 epochsLocked
	) public {
		epochsLocked = bound(
			epochsLocked,
			GTokenLib.MIN_EPOCHS_LOCK,
			GTokenLib.MAX_EPOCHS_LOCK
		);

		GTokenLib.Attributes memory attributes = _createAttributes(
			liqValue,
			epochsLocked
		);

		if (liqValue > type(uint256).max / epochsLocked) {
			vm.expectRevert("GToken: Stake weight overflow");
		}

		GTokenLib.Attributes memory result = attributes.computeStakeWeight(0);

		if (liqValue <= type(uint256).max / epochsLocked) {
			assertEq(
				result.stakeWeight,
				liqValue * epochsLocked,
				"Incorrect stake weight"
			);
		}
	}

	// Fuzz test for `split`
	function testSplit(
		uint256 liqValue,
		uint256 liquidity,
		uint256[] memory liquidityPortions
	) public pure {
		GTokenLib.Attributes memory attributes = _createAttributes(liqValue, 1);

		// Ensure non-zero liquidity to avoid division errors
		liquidity = bound(liquidity, 1, type(uint256).max);
		attributes.lpDetails.liquidity = liquidity;

		uint256 portionsSum;
		for (uint256 i = 0; i < liquidityPortions.length; i++) {
			liquidityPortions[i] = bound(liquidityPortions[i], 1, 1e18); // Limit portions to reasonable values
			portionsSum += liquidityPortions[i];
		}
		vm.assume(portionsSum > 0); // Ensure valid input

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
		currentEpoch = bound(
			currentEpoch,
			epochStaked,
			epochStaked + epochsLocked
		);
		
		GTokenLib.Attributes memory attributes = _createAttributes(
			1,
			epochsLocked
		);
		attributes.epochStaked = epochStaked;


		uint256 elapsed = attributes.epochsElapsed(currentEpoch);
		uint256 left = attributes.epochsLeft(currentEpoch);

		assertEq(
			left,
			epochsLocked > elapsed ? epochsLocked - elapsed : 0,
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
		GTokenLib.Attributes memory attributes = _createAttributes(
			1,
			epochsLocked
		);
		attributes.lastClaimEpoch = bound(lastClaimEpoch, 0, epochsLocked);

		uint256 unclaimed = attributes.epochsUnclaimed();

		assertEq(
			unclaimed,
			epochsLocked - lastClaimEpoch,
			"Epochs unclaimed mismatch"
		);
	}

	// Fuzz test for `valueToKeep`
	function testValueToKeep(
		uint256 liqValue,
		uint256 epochsLocked,
		uint256 currentEpoch
	) public pure {
		vm.assume(
			epochsLocked > 0 && epochsLocked <= GTokenLib.MAX_EPOCHS_LOCK
		);
		vm.assume(liqValue <= type(uint104).max);

		GTokenLib.Attributes memory attributes = _createAttributes(
			liqValue,
			epochsLocked
		);

		vm.assume(currentEpoch >= attributes.epochStaked + epochsLocked);

		uint256 valueToKeep = attributes.valueToKeep(liqValue, currentEpoch);

		// Ensure the result is within reasonable bounds
		assertLe(valueToKeep, liqValue, "Value to keep exceeds input value");
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
