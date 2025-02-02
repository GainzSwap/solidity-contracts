// SPDX-License-Identifier: MIT

// Adapted from https://github.com/newtmex/weth-invariant-testing

pragma solidity ^0.8.13;

import { CommonBase } from "forge-std/Base.sol";
import { Test } from "forge-std/Test.sol";
import { StdCheats } from "forge-std/StdCheats.sol";
import { StdUtils } from "forge-std/StdUtils.sol";
import { console } from "forge-std/console.sol";
import { AddressSet, LibAddressSet } from "./helpers/AddressSet.sol";
import { WNTV } from "../../../tokens/WNTV.sol";
import { WEDU } from "../../../oc/WEDU.sol";

uint256 constant ETH_SUPPLY = 1_000_000_000 ether;

contract Handler is CommonBase, StdCheats, StdUtils {
	using LibAddressSet for AddressSet;

	WNTV public weth;

	uint256 public ghost_depositSum;
	uint256 public ghost_withdrawSum;
	uint256 public ghost_forcePushSum;

	uint256 public ghost_zeroWithdrawals;
	uint256 public ghost_zeroTransfers;
	uint256 public ghost_zeroTransferFroms;

	mapping(bytes32 => uint256) public calls;

	AddressSet internal _actors;
	address internal currentActor;

	modifier createActor() {
		vm.assume(msg.sender != weth.wedu());

		currentActor = msg.sender;
		_actors.add(msg.sender);
		_;
	}

	modifier useActor(uint256 actorIndexSeed) {
		currentActor = _actors.rand(actorIndexSeed);
		vm.assume(currentActor != address(0));

		_;
	}

	modifier countCall(bytes32 key) {
		calls[key]++;
		_;
	}

	constructor(WNTV _weth) {
		weth = _weth;
		deal(address(this), ETH_SUPPLY);
	}

	function deposit(uint256 amount) public createActor countCall("deposit") {
		amount = bound(amount, 0, address(this).balance);
		_pay(currentActor, amount);

		vm.prank(currentActor);
		(bool s, ) = payable(address(weth)).call{ value: amount }("");
		require(s, "Deposit not succeded");

		if (currentActor != address(weth)) ghost_depositSum += amount;
	}

	function withdraw(
		uint256 actorSeed,
		uint256 amount
	) public useActor(actorSeed) countCall("withdraw") {
		amount = bound(amount, 0, weth.balanceOf(currentActor));
		if (amount == 0) ghost_zeroWithdrawals++;

		vm.startPrank(currentActor);
		weth.withdraw(amount);
		_pay(address(this), amount);
		vm.stopPrank();

		ghost_withdrawSum += amount;
	}

	function approve(
		uint256 actorSeed,
		uint256 spenderSeed,
		uint256 amount
	) public useActor(actorSeed) countCall("approve") {
		address spender = _actors.rand(spenderSeed);

		vm.prank(currentActor);
		weth.approve(spender, amount);
	}

	function transfer(
		uint256 actorSeed,
		uint256 toSeed,
		uint256 amount
	) public useActor(actorSeed) countCall("transfer") {
		address to = _actors.rand(toSeed);

		amount = bound(amount, 0, weth.balanceOf(currentActor));
		if (amount == 0) ghost_zeroTransfers++;

		vm.prank(currentActor);
		weth.transfer(to, amount);
	}

	function transferFrom(
		uint256 actorSeed,
		uint256 fromSeed,
		uint256 toSeed,
		bool _approve,
		uint256 amount
	) public useActor(actorSeed) countCall("transferFrom") {
		address from = _actors.rand(fromSeed);
		address to = _actors.rand(toSeed);

		amount = bound(amount, 0, weth.balanceOf(from));

		if (_approve) {
			vm.prank(from);
			weth.approve(currentActor, amount);
		} else {
			amount = bound(amount, 0, weth.allowance(from, currentActor));
		}
		if (amount == 0) ghost_zeroTransferFroms++;

		vm.prank(currentActor);
		weth.transferFrom(from, to, amount);
	}

	function sendFallback(
		uint256 amount
	) public createActor countCall("sendFallback") {
		amount = bound(amount, 0, address(this).balance);
		_pay(currentActor, amount);

		vm.prank(currentActor);
		_pay(address(weth), amount);

		ghost_depositSum += amount;
	}

	function forEachActor(function(address) external func) public {
		return _actors.forEach(func);
	}

	function reduceActors(
		uint256 acc,
		function(uint256, address) external returns (uint256) func
	) public returns (uint256) {
		return _actors.reduce(acc, func);
	}

	function actors() external view returns (address[] memory) {
		return _actors.addrs;
	}

	function callSummary() external view {
		console.log("Call summary:");
		console.log("-------------------");
		console.log("deposit", calls["deposit"]);
		console.log("withdraw", calls["withdraw"]);
		console.log("sendFallback", calls["sendFallback"]);
		console.log("approve", calls["approve"]);
		console.log("transfer", calls["transfer"]);
		console.log("transferFrom", calls["transferFrom"]);
		console.log("forcePush", calls["forcePush"]);
		console.log("-------------------");

		console.log("Zero withdrawals:", ghost_zeroWithdrawals);
		console.log("Zero transferFroms:", ghost_zeroTransferFroms);
		console.log("Zero transfers:", ghost_zeroTransfers);
	}

	function _pay(address to, uint256 amount) internal {
		(bool s, ) = to.call{ value: amount }("");
		require(s, "pay() failed");
	}

	receive() external payable {}
}

contract WNTVInvariants is Test {
	WNTV public weth;
	Handler public handler;
	WEDU wedu;

	function setUp() public {
		wedu = new WEDU();

		weth = new WNTV();
		weth.initialize();
		weth.setup();
		weth.setWEDU(address(wedu));

		handler = new Handler(weth);

		bytes4[] memory selectors = new bytes4[](6);
		selectors[0] = Handler.deposit.selector;
		selectors[1] = Handler.withdraw.selector;
		selectors[2] = Handler.sendFallback.selector;
		selectors[3] = Handler.approve.selector;
		selectors[4] = Handler.transfer.selector;
		selectors[5] = Handler.transferFrom.selector;

		targetSelector(
			FuzzSelector({ addr: address(handler), selectors: selectors })
		);

		targetContract(address(handler));
	}

	// ETH can only be wrapped into WETH, WETH can only
	// be unwrapped back into ETH. The sum of the Handler's
	// ETH balance plus the WETH totalSupply() should always
	// equal the total ETH_SUPPLY.
	function invariant_conservationOfETH() public view {
		assertEq(
			ETH_SUPPLY,
			address(handler).balance +
				address(weth).balance +
				weth.totalSupply()
		);
		assertEq(wedu.balanceOf(address(weth)), weth.totalSupply());
	}

	// The WETH contract's Ether balance should always be
	// at least as much as the sum of individual deposits
	function invariant_solvencyDeposits() public view {
		assertEq(
			wedu.balanceOf(address(weth)) + address(weth).balance,
			handler.ghost_depositSum() +
				handler.ghost_forcePushSum() -
				handler.ghost_withdrawSum()
		);
	}

	// The WETH contract's Ether balance should always be
	// at least as much as the sum of individual balances
	function invariant_solvencyBalances() public {
		uint256 sumOfBalances = handler.reduceActors(0, this.accumulateBalance);
		assertEq(
			wedu.balanceOf(address(weth)) - handler.ghost_forcePushSum(),
			sumOfBalances
		);
	}

	function accumulateBalance(
		uint256 balance,
		address caller
	) external view returns (uint256) {
		return balance + weth.balanceOf(caller);
	}

	// No individual account balance can exceed the
	// WETH totalSupply().
	function invariant_depositorBalances() public {
		handler.forEachActor(this.assertAccountBalanceLteTotalSupply);
	}

	function assertAccountBalanceLteTotalSupply(address account) external view {
		assertLe(weth.balanceOf(account), weth.totalSupply());
	}

	function invariant_callSummary() public view {
		handler.callSummary();
	}

	receive() external payable {}
}
