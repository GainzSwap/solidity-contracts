// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Governance, GTokenLib, Epochs } from "../Governance.sol";
import { Router } from "../Router.sol";
import { TokenPayment, TokenPayments } from "../libraries/TokenPayments.sol";
import { Epochs } from "../libraries/Epochs.sol";
import { ERC1155Holder } from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import { RouterFixture, Gainz, WNTV } from "./shared/RouterFixture.sol";

contract GovernanceTest is Test, ERC1155Holder, RouterFixture {
	Governance governance;

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

		router.createPair(paymentA, paymentB);
	}

	function testFuzz_stake(uint256 amount, uint256 epochsLocked) public {
		vm.assume(
			1e-15 ether <= amount && amount <= gainz.balanceOf(address(this))
		);
		epochsLocked=bound(epochsLocked,GTokenLib.MIN_EPOCHS_LOCK, GTokenLib.MAX_EPOCHS_LOCK);

		TokenPayment memory payment = TokenPayment({
			nonce: 0,
			amount: amount,
			token: address(gainz)
		});
		address[][3] memory paths;
		uint256 amountOutMinA = 1;
		uint256 amountOutMinB = 1;

		address[] memory pathA = new address[](1);
		address[] memory pathB = new address[](2);
		address[] memory pathToNative = new address[](2);

		pathToNative[0] = pathB[0] = pathA[0] = payment.token;
		pathToNative[1] = pathB[1] = address(wNative);

		paths[0] = pathA;
		paths[1] = pathB;
		paths[2] = pathToNative;

		gainz.approve(address(governance), amount);

vm.warp(block.timestamp+20 minutes);
		governance.stake(payment, epochsLocked, paths, amountOutMinA, amountOutMinB);
		governance.unStake(1,1,1);
	}
}
