// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Test } from "forge-std/Test.sol";
import { WNTV } from "../../../tokens/WNTV.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract WNTVTest is Test {
	WNTV wntv;

	function setUp() external {
		wntv = new WNTV();
		wntv.initialize(address(this));
		wntv.setYuzuAggregator(address(this));
	}

	function testWithdraw(uint256 amount, uint256 timestamp) external {
		address owner = msg.sender;
		timestamp = bound(timestamp, 0, 1000 * 366 days);

		vm.assume(amount <= 1_000_000_000 ether && owner != address(0));
		vm.deal(address(this), amount);

		vm.warp(timestamp);

		wntv.receiveFor{ value: amount }(owner);
		_checkWNTVBalance();

		vm.prank(owner);
		wntv.withdraw(amount);
		vm.stopPrank();

		WNTV.UserWithdrawal memory withdrawal = wntv.userPendingWithdrawals(
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

		uint256 prevBal = payable(owner).balance;
		vm.prank(owner);
		wntv.completeWithdrawal();
		vm.stopPrank();

		assertEq(
			payable(owner).balance,
			prevBal + amount,
			"Balance check failed"
		);
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

	function testOwnerCanWithdrawETH() external {
		uint256 ethToSend = 10 ether;

		_sendETHToContract(ethToSend);

		uint256 ownerInitial = address(this).balance;

		wntv.withdrawETHBalance(payable(address(this)));

		assertEq(
			address(wntv).balance,
			0,
			"Contract ETH balance should be zero"
		);
		assertEq(
			address(this).balance,
			ownerInitial + ethToSend,
			"Owner did not receive withdrawn ETH"
		);
	}

	function testWithdrawETHFailsIfNotOwner(address payable attacker) external {
		vm.assume(attacker != address(0) && attacker != address(this));

		_sendETHToContract(5 ether);

		vm.prank(attacker);
		vm.expectRevert(
			abi.encodeWithSelector(
				OwnableUpgradeable.OwnableUnauthorizedAccount.selector,
				attacker
			)
		);
		wntv.withdrawETHBalance(attacker);
	}

	function testWithdrawETHRevertsIfEmpty() external {
		// No ETH in contract
		assertEq(address(wntv).balance, 0);

		vm.expectRevert("No ETH to withdraw");
		wntv.withdrawETHBalance(payable(address(this)));
	}

	function testSetTargetSupply(uint256 target) public {
		vm.assume(target > 0);

		wntv.setTargetSupply(target);

		assertEq(wntv.getTargetSupply(), target);
	}

	function testSetTargetSupply_RevertIfZero() public {
		vm.expectRevert("Target must be > 0");
		wntv.setTargetSupply(0);
	}

	function testScaleEmission_ZeroSupply() public {
		uint256 amount = 100 ether;

		wntv.setTargetSupply(1_000 ether);

		uint256 scaled = wntv.scaleEmission(amount);
		assertEq(scaled, 0);
	}

	function testScaleEmission_ZeroTarget() public view {
		uint256 amount = 100 ether;

		uint256 scaled = wntv.scaleEmission(amount);
		assertEq(scaled, 0);
	}

	function testScaleEmission_FullTargetSupply() public {
		uint256 target = 1_000 ether;
		uint256 amount = 100 ether;

		address user = makeAddr("user");

		wntv.setTargetSupply(target);

		vm.deal(user, target);
		vm.prank(user);
		wntv.receiveFor{ value: target }(user);

		uint256 scaled = wntv.scaleEmission(amount);

		assertEq(scaled, amount);
		assertGt(scaled, 0);
	}

	function testScaleEmission_OverTargetSupply() public {
		uint256 target = 1_000 ether;
		uint256 amount = 100 ether;
		address user = makeAddr("user");

		wntv.setTargetSupply(target);

		vm.deal(user, 2_000 ether);
		vm.prank(user);
		wntv.receiveFor{ value: 2_000 ether }(user);

		uint256 scaled = wntv.scaleEmission(amount);

		assertEq(scaled, amount);
		assertGt(scaled, 0);
	}

	function testScaleEmission_UnderTargetSupply() public {
		uint256 target = 2_000 ether;
		uint256 amount = 100 ether;
		address user = makeAddr("user");

		wntv.setTargetSupply(target);

		vm.deal(user, 500 ether);
		vm.prank(user);
		wntv.receiveFor{ value: 500 ether }(user);

		uint256 scaled = wntv.scaleEmission(amount);

		assertLt(scaled, amount);
		assertGt(scaled, 0);
	}

	function testFuzz_ScaleEmission(uint256 supply, uint256 amount) public {
		vm.assume(supply > 0 && supply < 1_000_000 ether);
		vm.assume(amount > 0 && amount < 1_000 ether);
		address user = makeAddr("user");

		wntv.setTargetSupply(1_000_000 ether);

		vm.deal(user, supply);
		vm.prank(user);
		wntv.receiveFor{ value: supply }(user);

		uint256 scaled = wntv.scaleEmission(amount);

		assertLe(scaled, amount);
	}

	function testFuzz_TargetAndSupply(uint256 target, uint256 supply) public {
		target = bound(target, 1, 1_000_000 ether);
		supply = bound(supply, 1, 2_000_000 ether);
		address user = makeAddr("user");

		wntv.setTargetSupply(target);

		vm.deal(user, supply);
		vm.prank(user);
		wntv.receiveFor{ value: supply }(user);

		uint256 scaled = wntv.scaleEmission(100 ether);
		assertLe(scaled, 100 ether);
	}

	function _sendETHToContract(uint256 amount) internal {
		vm.deal(address(wntv), amount);
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
