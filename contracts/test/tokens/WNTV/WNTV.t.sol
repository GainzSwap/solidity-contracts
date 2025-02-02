// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { WNTV } from "../../../tokens/WNTV.sol";
import { WEDU } from "../../../oc/WEDU.sol";

contract WNTVTest is Test {
	address payable wedu;
	WNTV wntv;

	function setUp() external {
		wedu = payable(address(new WEDU()));

		wntv = new WNTV();
		wntv.initialize();
		wntv.setup();
		wntv.setWEDU(wedu);
	}

	function testCannotSetupMoreThanOnce() external {
		vm.expectRevert("Already set");
		wntv.setup();
	}

	function testWithdraw(uint256 amount) external {
		vm.deal(address(this), amount);

		wntv.receiveFor{ value: amount }(address(this));

		_checkWNTVBalance(amount);

		wntv.withdraw(amount);
		assertEq(
			payable(address(this)).balance,
			amount,
			"Balance check failed"
		);
	}

	function testReceivesETH(uint256 amount) external {
		address payable wntvPayable = payable(address(wntv));

		vm.deal(address(this), amount);

		(bool s, ) = wntvPayable.call{ value: amount }("");
		assertTrue(s, "Deposit call failed");

		assertEq(wntvPayable.balance, amount, "Balance check failed");
	}

	function testReceiveForSpender(
		address owner,
		address spender,
		uint256 amount
	) external {
		vm.assume(owner != address(0) && spender != address(0));

		vm.deal(address(this), amount);

		wntv.receiveForSpender{ value: amount }(owner, spender);
		_checkWNTVBalance(amount);

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
		_checkWNTVBalance(amount);

		assertEq(
			wntv.balanceOf(owner),
			amount,
			"Owner should have the balance"
		);
	}

	function _checkWNTVBalance(uint amount) internal view {
		address payable wntvPayable = payable(address(wntv));
		assertEq(
			wntvPayable.balance,
			0,
			"WNTV should not hold native token during Yuzu staking"
		);
		assertEq(
			WEDU(wedu).balanceOf(wntvPayable),
			amount,
			"WNTV immediately stake deposit EDU for Yuzu farming"
		);
	}

	receive() external payable {}
}
