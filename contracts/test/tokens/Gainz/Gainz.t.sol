// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console } from "forge-std/Test.sol";
import { RouterFixture, Gainz } from "../../shared/RouterFixture.sol";
import { Governance } from "../../../Governance.sol";

contract GainzTest is Test, RouterFixture {
	Governance governance;

	function setUp() public {
		governance = Governance(payable(router.getGovernance()));
	}

	function testFuzz_mintGainz() public {
		gainz.runInit(address(governance));

		// Arrange
		vm.warp(360 days);

		// Act
		uint256 emittedGainz = gainz.stakersGainzToEmit();
		gainz.mintGainz();

		// Assert
		string[3] memory fixtureEntity = ["team", "growth", "liqIncentive"];
		for (uint256 i = 0; i < fixtureEntity.length; i++) {
			string memory entity = fixtureEntity[i];
			address entityAddress = makeAddr(entity);

			uint256 governanceBalance = gainz.balanceOf(address(governance));
			assertEq(
				governanceBalance,
				emittedGainz,
				"Governance should receive all emitted gainz"
			);

			uint256 entityAmount = gainz.sendGainz(entityAddress, entity);
			assert(entityAmount > 0);
			assertEq(
				gainz.sendGainz(entityAddress, entity),
				0,
				"Subsequent SendGainz Call in the same timestamp should return zero"
			);
			assertEq(
				entityAmount,
				gainz.balanceOf(entityAddress),
				"Entity Address should receive the gainz"
			);
		}
	}

	function testRunInitRevertsInvalidAddress() public {
		// Attempt to initialize with an invalid governance address
		vm.expectRevert("Invalid Address");
		gainz.runInit(address(0));
	}

	function testRunInitRevertsInvalidGovernanceCall() public {
		// Attempt to initialize with the mocked failure
		vm.expectRevert("Invalid Governance Call");
		gainz.runInit(address(0x123));
	}
}
