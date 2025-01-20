// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import { SFT } from "../abstracts/SFT.sol";
import { IERC1155Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract ConcreteSFT is SFT {
	function initialize(
		string memory name_,
		string memory symbol_
	) external initializer {
		__SFT_init(name_, symbol_, msg.sender);
	}

	function mint(
		address to,
		uint256 amount,
		bytes memory attributes
	) external returns (uint256) {
		return _mint(to, amount, attributes);
	}

	function sftBalance(
		address user
	) external view returns (SftBalance[] memory) {
		return _sftBalance(user);
	}

	function getRawTokenAttributes(
		uint256 nonce
	) external view returns (bytes memory) {
		return _getRawTokenAttributes(nonce);
	}
}

contract SFTTest is Test {
	ConcreteSFT private sft;

	address private owner = address(1);
	address private user = address(2);

	function setUp() public {
		vm.startPrank(owner);
		sft = new ConcreteSFT();
		sft.initialize("Test SFT", "TSFT");
		vm.stopPrank();
	}

	function testInitialSetup() public view {
		assertEq(sft.name(), "Test SFT");
		assertEq(sft.symbol(), "TSFT");
		assertTrue(sft.isOperator(owner));
	}

	function testMint(uint256 amount, bytes memory attributes) public {
		vm.assume(amount > 0);

		vm.startPrank(owner);
		uint256 nonce = sft.mint(user, amount, attributes);
		vm.stopPrank();

		uint256[] memory userNonces = sft.getNonces(user);
		assertEq(userNonces.length, 1);
		assertEq(userNonces[0], nonce);

		bytes memory storedAttributes = sft.getRawTokenAttributes(nonce);
		assertEq(storedAttributes, attributes);
	}

	function testUpdate(
		uint256 initialAmount,
		bytes memory newAttributes
	) public {
		vm.assume(initialAmount > 0);
		vm.startPrank(owner);
		uint256 initialNonce = sft.mint(user, initialAmount, "Initial");
		vm.stopPrank();

		vm.startPrank(owner);
		uint256 newNonce = sft.update(
			user,
			initialNonce,
			initialAmount,
			newAttributes
		);
		vm.stopPrank();

		uint256[] memory userNonces = sft.getNonces(user);
		assertEq(userNonces.length, 1);
		assertEq(userNonces[0], newNonce);

		bytes memory updatedAttributes = sft.getRawTokenAttributes(newNonce);
		assertEq(updatedAttributes, newAttributes);
	}

	// function testUpdateWhenNewAmountNotEqualInitial(
	// 	uint256 initialAmount,
	// 	uint256 newAmount,
	// 	bytes memory newAttributes
	// ) public {
	// 	vm.assume(initialAmount != newAmount);

	// 	vm.startPrank(owner);
	// 	uint256 initialNonce = sft.mint(user, initialAmount, "Initial");
	// 	vm.stopPrank();

	// 	vm.startPrank(owner);
	// 	vm.expectPartialRevert(
	// 		IERC1155Errors.ERC1155InsufficientBalance.selector
	// 	);
	// 	sft.update(user, initialNonce, newAmount, newAttributes);
	// 	vm.stopPrank();
	// }

	function testNonOperatorCannotUpdate() public {
		vm.startPrank(owner);
		uint256 nonce = sft.mint(user, 10, "Attributes");
		vm.stopPrank();

		vm.startPrank(user);
		vm.expectRevert(
			abi.encodeWithSelector(SFT.ActionNotAllowed.selector, user)
		);
		sft.update(user, nonce, 10, "Updated");
		vm.stopPrank();
	}

	function testTransferUpdatesNonces(uint256 amount) public {
		vm.assume(amount > 0);

		vm.startPrank(owner);
		uint256 nonce = sft.mint(user, amount, "Attributes");
		vm.stopPrank();

		address recipient = address(4);

		vm.startPrank(user);
		sft.safeTransferFrom(user, recipient, nonce, amount, "");
		vm.stopPrank();

		assertTrue(sft.hasSFT(recipient, nonce));
		assertFalse(sft.hasSFT(user, nonce));
	}

	function testBalanceWithAttributes(uint256 amount) public {
		vm.assume(amount > 0);

		vm.startPrank(owner);
		uint256 nonce = sft.mint(user, amount, "Attributes");
		vm.stopPrank();

		SFT.SftBalance[] memory balances = sft.sftBalance(user);
		assertEq(balances.length, 1);
		assertEq(balances[0].nonce, nonce);
		assertEq(balances[0].amount, amount);
		assertEq(balances[0].attributes, "Attributes");
	}
}
