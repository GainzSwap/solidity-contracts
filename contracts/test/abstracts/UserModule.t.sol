// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { UserModule, ReferralInfo } from "../../abstracts/UserModule.sol";

contract ConcreteUserModule is UserModule {
	function createOrGetUserId(
		address userAddr,
		uint256 referrerId
	) external returns (uint256 userId) {
		return _createOrGetUserId(userAddr, referrerId);
	}
}

contract UserModuleTest is Test {
	ConcreteUserModule userModule;

	address user1 = address(0x100);
	address user2 = address(0x200);
	address user3 = address(0x300);

	function setUp() public {
		userModule = new ConcreteUserModule();
	}

	function testCreateNewUser() public {
		vm.expectEmit(true, true, true, false);
		emit UserModule.UserRegistered(1, user1, 0);

		uint256 userId = userModule.createOrGetUserId(user1, 0);
		assertEq(userId, 1);
		assertEq(userModule.getUserId(user1), 1);
	}

	function testCreateNewUserInvalidRefIDs(
		uint256 refId,
		address user
	) public {
		uint256 user1Id = userModule.createOrGetUserId(user1, 0);
		userModule.createOrGetUserId(user2, user1Id);
		uint256 user3Id = userModule.createOrGetUserId(user3, 0);

		vm.assume(refId > user3Id);

		vm.expectEmit(true, true, true, true);
		emit UserModule.UserRegistered(user3Id + 1, user, 0);
		userModule.createOrGetUserId(user, refId);
	}

	function testCreateUserWithReferrer() public {
		uint256 referrerId = userModule.createOrGetUserId(user1, 0);
		assertEq(referrerId, 1);

		vm.expectEmit(true, true, true, true);
		emit UserModule.UserRegistered(2, user2, 1);
		emit UserModule.ReferralAdded(1, 2);

		uint256 userId = userModule.createOrGetUserId(user2, 1);
		assertEq(userId, 2);
		assertEq(userModule.getUserId(user2), 2);
	}

	function testExistingUserReturnsSameId() public {
		uint256 userId1 = userModule.createOrGetUserId(user1, 0);
		uint256 userId2 = userModule.createOrGetUserId(user1, 0);
		assertEq(userId1, userId2);
	}

	function testReferralsStoredCorrectly() public {
		uint256 referrerId = userModule.createOrGetUserId(user1, 0);
		uint256 userId = userModule.createOrGetUserId(user2, referrerId);

		ReferralInfo[] memory referrals = userModule.getReferrals(user1);
		assertEq(referrals.length, 1);
		assertEq(referrals[0].id, userId);
		assertEq(referrals[0].referralAddress, user2);
	}

	function testFailInvalidUserAddress() public {
		userModule.createOrGetUserId(address(0), 0);
	}
}
