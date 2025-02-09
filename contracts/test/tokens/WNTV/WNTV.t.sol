// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Test } from "forge-std/Test.sol";
import { dEDU } from "../../../tokens/WNTV.sol";

contract WNTVTest is Test {
	dEDU wntv;

	function setUp() external {
		wntv = new dEDU();
		wntv.initialize();
		wntv.setup();
		wntv.setYuzuAggregator(address(this));
	}

	function testCannotSetupMoreThanOnce() external {
		vm.expectRevert("Already set");
		wntv.setup();
	}

	function testWithdraw(
		uint256 amount,
		address owner,
		uint256 timestamp
	) external {
		timestamp = bound(timestamp, 0, 1000 * 366 days);

		vm.assume(amount <= 1_000_000_000 ether && owner != address(0));
		vm.deal(address(this), amount);

		vm.warp(timestamp);

		wntv.receiveFor{ value: amount }(owner);
		_checkWNTVBalance();

		vm.prank(owner);
		wntv.withdraw(amount);
		vm.stopPrank();

		dEDU.UserWithdrawal memory withdrawal = wntv.userPendingWithdrawals(
			owner
		);
		assertEq(withdrawal.amount, amount, "Withdrawal amount not match");
		assertGt(
			withdrawal.readyTimestamp,
			block.timestamp,
			"Withdrawal timestamp not match"
		);

		vm.warp(withdrawal.readyTimestamp);
		wntv.settleWithdrawals{ value: wntv.pendingWithdrawals() }();

		vm.prank(owner);
		wntv.completeWithdrawal();
		vm.stopPrank();

		assertEq(payable(owner).balance, amount, "Balance check failed");
	}

	function testReceivesETH(uint256 amount, address owner) external {
		address payable wntvPayable = payable(address(wntv));

		vm.assume(amount <= 1_000_000_000 ether && owner != address(0));
		vm.deal(owner, amount);

		vm.prank(owner);
		(bool s, ) = wntvPayable.call{ value: amount }("");
		assertTrue(s, "Deposit call failed");
		vm.stopPrank();

		_checkWNTVBalance();

		assertEq(
			wntv.balanceOf(owner),
			amount,
			"Owner should have the balance"
		);
	}

	function testReceiveForSpender(
		address owner,
		address spender,
		uint256 amount
	) external {
		vm.assume(owner != address(0) && spender != address(0));

		vm.deal(address(this), amount);

		wntv.receiveForSpender{ value: amount }(owner, spender);
		_checkWNTVBalance();

		assertEq(
			wntv.balanceOf(owner),
			amount,
			"Owner should have the balance"
		);
		assertEq(
			wntv.allowance(owner, spender),
			amount,
			"Spender should be allowed amount"
		);
	}

	function testReceiveFor(address owner) external {
		vm.assume(owner != address(0));

		uint256 amount = 50 ether;
		vm.deal(address(this), amount);

		wntv.receiveFor{ value: amount }(owner);
		_checkWNTVBalance();

		assertEq(
			wntv.balanceOf(owner),
			amount,
			"Owner should have the balance"
		);
	}

	function _checkWNTVBalance() internal view {
		address payable wntvPayable = payable(address(wntv));
		assertEq(
			wntvPayable.balance,
			0,
			"WNTV should not hold native token during Yuzu staking"
		);
	}

	receive() external payable {}
}
