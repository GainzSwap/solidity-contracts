// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console } from "forge-std/Test.sol";
import { CommonBase } from "forge-std/Base.sol";
import { StdUtils } from "forge-std/StdUtils.sol";
import { StdAssertions } from "forge-std/StdAssertions.sol";
import { GToken, GTokenLib, LiquidityInfo, Epochs, GTokenBalance } from "../../../tokens/GToken/GToken.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract GTokenHandler is CommonBase, StdUtils, StdAssertions {
	using Epochs for Epochs.Storage;
	using EnumerableSet for EnumerableSet.AddressSet;

	GToken public gToken;
	Epochs.Storage public epochs;
	address owner;

	uint256 public ghost_mintedStakeWeight;
	uint256 public ghost_burnedStakeWeight;

	uint256 public ghost_mintedSupply;
	uint256 public ghost_burnedSupply;

	constructor(GToken _gToken, Epochs.Storage memory _epochs, address _owner) {
		gToken = _gToken;
		epochs = _epochs;
		owner = _owner;

		ghost_mintedStakeWeight = gToken.totalStakeWeight();
		ghost_mintedSupply = gToken.totalSupply();
	}

	EnumerableSet.AddressSet actors;
	address currentActor;
	uint256 currentActorNonce;

	function moveTime(uint256 secs) public {
		vm.assume(secs <= 1080 days);
		vm.warp(block.timestamp + secs);
	}

	modifier constrainLpDetails(LiquidityInfo memory lpDetails) {
		vm.assume(
			type(uint8).max < lpDetails.liqValue &&
				lpDetails.liqValue <= type(uint256).max / 9e18
		);
		vm.assume(
			type(uint8).max < lpDetails.liquidity &&
				lpDetails.liquidity <= type(uint256).max / 9e18
		);
		_;
	}

	modifier constrainEpochsLocked(uint256 epochsLocked) {
		vm.assume(
			GTokenLib.MIN_EPOCHS_LOCK <= epochsLocked &&
				epochsLocked <= GTokenLib.MAX_EPOCHS_LOCK
		);
		if (epochs.currentEpoch() < 180) {
			vm.assume(epochsLocked >= 180);
		}

		_;
	}

	modifier setActor(uint toIndex, uint nonceIndex) {
		currentActor = actors.length() > 0
			? actors.at(toIndex % actors.length())
			: msg.sender;

		uint256[] memory nonces = gToken.getNonces(currentActor);

		if (nonces.length > 0) {
			currentActorNonce = nonces[nonceIndex % nonces.length];
		}

		_;

		currentActor = address(0);
		currentActorNonce = 0;
	}

	function mintGToken(
		address to,
		uint256 rewardPerShare,
		uint256 epochsLocked,
		LiquidityInfo memory lpDetails
	)
		external
		constrainLpDetails(lpDetails)
		constrainEpochsLocked(epochsLocked)
	{
		vm.assume(0 < uint160(to) && uint160(to) <= 1234);

		vm.prank(owner);
		uint256 nonce = gToken.mintGToken(
			to,
			rewardPerShare,
			epochsLocked,
			lpDetails
		);
		vm.stopPrank();

		GTokenBalance memory balance = gToken.getBalanceAt(to, nonce);
		actors.add(to);

		ghost_mintedStakeWeight += balance.attributes.stakeWeight;
		ghost_mintedSupply += balance.amount;
	}

	function split(
		uint toIndex,
		uint nonceIndex,
		address[] memory addresses,
		uint256[] memory liquidityPortions
	) external setActor(toIndex, nonceIndex) {
		vm.assume(0 < addresses.length && addresses.length <= 3);
		vm.assume(addresses.length == liquidityPortions.length);

		if (currentActorNonce == 0) return;

		// Keep liquidity Portions within range
		GTokenBalance memory userBalance = gToken.getBalanceAt(
			currentActor,
			currentActorNonce
		);
		uint256 availLiq = userBalance.attributes.lpDetails.liquidity;
		for (uint i = 0; i < addresses.length; i++) {
			uint256 liqToUse = liquidityPortions[i];
			if (liqToUse > availLiq) {
				liquidityPortions[i] = 0;
			} else {
				availLiq -= liqToUse;
			}
		}

		vm.prank(currentActor);

		uint256[] memory splitNonces = gToken.split(
			currentActorNonce,
			addresses,
			liquidityPortions
		);

		ghost_burnedStakeWeight += userBalance.attributes.stakeWeight;
		ghost_burnedSupply += userBalance.amount;

		vm.stopPrank();

		for (uint256 i = 0; i < splitNonces.length; i++) {
			uint256 splitNonce = splitNonces[i];
			if (splitNonce > 0) {
				address splitUser = addresses[i];
				GTokenBalance memory splitBalance = gToken.getBalanceAt(
					splitUser,
					splitNonce
				);
				actors.add(splitUser);

				ghost_mintedStakeWeight += splitBalance.attributes.stakeWeight;
				ghost_mintedSupply += splitBalance.amount;
			}
		}
	}
}

contract GTokenInvariant is Test {
	GToken public gToken;
	GTokenHandler public handler;

	function setUp() public {
		Epochs.Storage memory epochs = Epochs.Storage({
			epochLength: 1 days,
			genesis: block.timestamp
		});

		gToken = new GToken();
		gToken.initialize(epochs, address(this));

		handler = new GTokenHandler(gToken, epochs, address(this));

		bytes4[] memory selectors = new bytes4[](3);
		selectors[0] = GTokenHandler.moveTime.selector;
		selectors[1] = GTokenHandler.mintGToken.selector;
		selectors[2] = GTokenHandler.split.selector;

		targetSelector(
			FuzzSelector({ addr: address(handler), selectors: selectors })
		);

		targetContract(address(handler));
	}

	function invariant_TotalSupplyConsistency() public view {
		assertEq(
			gToken.totalSupply(),
			handler.ghost_mintedSupply() - handler.ghost_burnedSupply(),
			"Total supply mismatch"
		);
	}

	function invariant_TotalStakeWeightConsistency() public view {
		assertEq(
			gToken.totalStakeWeight(),
			handler.ghost_mintedStakeWeight() -
				handler.ghost_burnedStakeWeight(),
			"Total stake weight mismatch"
		);
	}
}
