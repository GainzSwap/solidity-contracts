// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console } from "forge-std/Test.sol";
import { CommonBase } from "forge-std/Base.sol";
import { StdUtils } from "forge-std/StdUtils.sol";
import { Gainz } from "../tokens/Gainz/Gainz.sol";
import { Governance, Epochs } from "../Governance.sol";

contract Handler is CommonBase, StdUtils {
	Gainz gainz;
	address public constant entityAddress = address(0x3);
	address owner;

	constructor(Gainz _gainz, address _owner) {
		gainz = _gainz;
		owner = _owner;
	}

	string[] public entities = ["team", "growth", "liqIncentive"];
	uint256 public ghost_entitiesGainzBal;

	function sendGainz(uint entityIndex) public {
		entityIndex = bound(entityIndex, 0, 2);
		vm.prank(owner);

		ghost_entitiesGainzBal += gainz.sendGainz(
			entityAddress,
			entities[entityIndex]
		);
	}

	uint256 public ghost_governaceGainzBal;

	function mintGainz(uint256 timestampIncrement, address caller) public {
		vm.assume(timestampIncrement < 10 days);
		vm.warp(block.timestamp + timestampIncrement);
		vm.prank(caller);

		ghost_governaceGainzBal += gainz.stakersGainzToEmit();
		gainz.mintGainz();
	}
}

contract GainzInvariant is Test {
	Gainz gainz;
	Governance governance;
	Handler handler;

	function setUp() public {
		gainz = new Gainz();
		gainz.initialize();

		governance = new Governance();
		governance.initialize(
			Epochs.Storage({ epochLength: 1 days, genesis: block.timestamp }),
			address(gainz),
			address(0x12),
			address(0x13)
		);

		gainz.runInit(address(governance));

		handler = new Handler(gainz, address(this));
		targetContract(address(handler));
	}

	function invariant_TotalSupplyConsistency() public view {
		uint256 totalBalance = gainz.balanceOf(handler.entityAddress()) +
			gainz.balanceOf(address(gainz)) +
			gainz.balanceOf(address(this)) +
			gainz.balanceOf(address(governance));

		assertEq(gainz.totalSupply(), totalBalance, "Total supply mismatch");
	}

	function invariant_EcosystemSupplyConsistency() public view {
		assertEq(
			gainz.balanceOf(handler.entityAddress()),
			handler.ghost_entitiesGainzBal(),
			"Entities supply mismatch"
		);

		assertEq(
			gainz.balanceOf(address(governance)),
			handler.ghost_governaceGainzBal(),
			"Governance supply mismatch"
		);
	}
}
