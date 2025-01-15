// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console } from "forge-std/Test.sol";
import { Entities, GainzEmission } from "../tokens/Gainz/GainzEmission.sol";

contract GainzEmissionTest is Test {
	using Entities for Entities.Value;
	using GainzEmission for uint256;

	function testFuzz_atEpoch(uint256 epoch) public pure {
		assertEq(GainzEmission.atEpoch(0), uint256(GainzEmission.E0));
		assertTrue(GainzEmission.atEpoch(1) < GainzEmission.atEpoch(0));

		vm.assume(epoch > 1 && epoch <= 1080);

		assertLt(
			GainzEmission.atEpoch(epoch + 1),
			GainzEmission.atEpoch(epoch),
			"Higher Epochs should emit less"
		);
	}

	function testFuzz_EpochsEmission(
		uint256 epochStart,
		uint256 epochEnd
	) public pure {
		vm.assume(epochStart < 100 * 366 days); // 100 years
		vm.assume(epochStart < epochEnd);
		vm.assume(epochEnd - epochStart <= 1080);

		uint256 throughTimeRangeCummulative;
		uint256 currentEpoch = epochStart;
		while (currentEpoch < epochEnd) {
			throughTimeRangeCummulative += currentEpoch.throughTimeRange(1, 1);
			currentEpoch += 1;
		}
		assertLe(
			epochStart.throughEpochRange(epochEnd),
			throughTimeRangeCummulative,
			"Commulative Computation missmatch"
		);
	}

	function testFuzz_totalValue(uint256 totalValue) public pure {
		vm.assume(
			totalValue <=
				type(uint256).max / (Entities.UNITY - Entities.STAKING)
		);

		Entities.Value memory entities = Entities.fromTotalValue(totalValue);
		assertEq(entities.total(), totalValue, "Total value missmatch");
	}

	Entities.Value fuzzAddEntities;

	function testFuzz_add(
		uint256 value1,
		uint256 value2,
		uint256 value3
	) public {
		vm.assume(
			value1 <= type(uint256).max / (Entities.UNITY - Entities.STAKING)
		);
		vm.assume(
			value2 <= type(uint256).max / (Entities.UNITY - Entities.STAKING)
		);
		vm.assume(
			value3 <= type(uint256).max / (Entities.UNITY - Entities.STAKING)
		);

		fuzzAddEntities = Entities.fromTotalValue(value1);
		fuzzAddEntities.add(Entities.fromTotalValue(value2));
		fuzzAddEntities.add(Entities.fromTotalValue(value3));

		assertEq(
			fuzzAddEntities.total(),
			value1 + value2 + value3,
			"Total value missmatch"
		);
	}
}
