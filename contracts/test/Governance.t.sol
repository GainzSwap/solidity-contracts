// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Governance, GTokenLib, Epochs } from "../Governance.sol";
import { Router } from "../Router.sol";
import { TokenPayment, TokenPayments } from "../libraries/TokenPayments.sol";
import { Epochs } from "../libraries/Epochs.sol";
import { ERC1155Holder } from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import { RouterFixture, Gainz, WNTV } from "./shared/RouterFixture.sol";
import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";

contract GovernanceTest is Test, ERC1155Holder, RouterFixture {
	Governance governance;
	address pairAddress;

	function setUp() public {
		governance = Governance(payable(router.getGovernance()));

		wNative.setYuzuAggregator(address(899999));

		TokenPayment memory paymentA = TokenPayment({
			nonce: 0,
			amount: 10 ether,
			token: address(gainz)
		});
		TokenPayment memory paymentB = TokenPayment({
			nonce: 0,
			amount: 1 ether,
			token: address(wNative)
		});

		wNative.receiveForSpender{ value: paymentB.amount }(
			address(this),
			address(router)
		);

		gainz.approve(address(router), paymentA.amount);

		(pairAddress, )=router.createPair(paymentA, paymentB);

		wNative.receiveFor{ value: 50 ether }(address(this));
	}

	function testFuzz_stake(
		uint256 amount,
		uint256 amountARatio,
		uint256 epochsLocked,
		bool stakeGainz
	) public {
		amount = bound(amount,25_00,50_00);
		amountARatio = bound(amountARatio,25_00,50_00);
		
		TokenPayment memory payment = TokenPayment({
			nonce: 0,
			amount:amount,
			token: stakeGainz ? address(gainz) : address(wNative)
		});
		vm.assume(
			1e-15 ether <= payment.amount &&
			payment.amount <= IERC20(payment.token).balanceOf(pairAddress)
		);
	uint256	amountInA = amount * amountARatio /100_000;
	uint256 amountInB= amount - amountInA;

		epochsLocked = bound(
			epochsLocked,
			GTokenLib.MIN_EPOCHS_LOCK,
			GTokenLib.MAX_EPOCHS_LOCK
		);

		address[][3] memory paths;
		uint256 [2][2] memory path_AB_amounts;

		path_AB_amounts[0][0] = amountInA;
		path_AB_amounts[0][1] = 1;
		path_AB_amounts[1][0] = amountInB;
		path_AB_amounts[1][1] = 1;

		address[] memory pathA = new address[](1);
		address[] memory pathB = new address[](2);
		address[] memory pathToNative = new address[](2);

		pathToNative[0] = pathB[0] = pathA[0] = payment.token;
		pathToNative[1] = pathB[1] = address(wNative);
		if (!stakeGainz) {
			pathToNative[0] = pathB[1] = address(gainz);
		}

		paths[0] = pathA;
		paths[1] = pathB;
		paths[2] = pathToNative;

		IERC20(payment.token).approve(address(governance), payment.amount);

		vm.warp(block.timestamp + 20 minutes);
		governance.stake(
			payment,
			epochsLocked,
			paths,
			path_AB_amounts,
			block.timestamp+1
		);
		governance.unStake(1, 1, 1);
	}
}
