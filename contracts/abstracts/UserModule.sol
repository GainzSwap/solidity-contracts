// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

struct ReferralInfo {
	uint256 id;
	address referralAddress;
}

struct User {
	uint256 id;
	address addr;
	uint256 referrerId;
	uint256[] referrals;
}

library UserModuleLib {
	/// @notice Gets the referrer and referrer ID of a user.
	/// @param userAddress The address of the user.
	/// @return referrerId The ID of the referrer, 0 if none.
	/// @return referrerAddress The address of the referrer, address(0) if none.
	function getReferrer(
		UserModule.UserStorage storage $,
		address userAddress
	) public view returns (uint256 referrerId, address referrerAddress) {
		User storage user = $.users[userAddress];
		referrerId = user.referrerId;
		referrerAddress = $.userIdToAddress[referrerId];
	}

	/// @notice Retrieves the referrals of a user.
	/// @param userAddress The address of the user.
	/// @return referrals An array of `ReferralInfo` structs representing the user's referrals.
	function getReferrals(
		UserModule.UserStorage storage $,
		address userAddress
	) external view returns (ReferralInfo[] memory) {
		uint256[] memory referralIds = $.users[userAddress].referrals;
		ReferralInfo[] memory referrals = new ReferralInfo[](
			referralIds.length
		);

		for (uint256 i = 0; i < referralIds.length; i++) {
			uint256 id = referralIds[i];
			address refAddr = $.userIdToAddress[id];
			referrals[i] = ReferralInfo({ id: id, referralAddress: refAddr });
		}

		return referrals;
	}

	/// @notice Internal function to create or get the user ID.
	/// @param userAddr The address of the user.
	/// @param referrerId The ID of the referrer.
	function createOrGetUserId(
		UserModule.UserStorage storage $,
		address userAddr,
		uint256 referrerId
	) external returns (uint256 userId, bool isNewUser, bool isRefAdded) {
		User storage user = $.users[userAddr];

		// If user already exists, return the existing ID
		if (user.id != 0) {
			return (user.id, false, false);
		}

		// Increment user count and assign new user ID
		$.userCount++;
		$.users[userAddr] = User({
			id: $.userCount,
			addr: userAddr,
			referrerId: referrerId,
			referrals: new uint256[](0)
		});
		$.userIdToAddress[$.userCount] = userAddr;

		// Add user to referrer's referrals list, if applicable
		if (
			referrerId != 0 &&
			referrerId != $.userCount &&
			$.userIdToAddress[referrerId] != address(0)
		) {
			$.users[$.userIdToAddress[referrerId]].referrals.push($.userCount);
			isRefAdded = true;
		}

		isNewUser = true;
		userId = $.userCount;
	}
}

abstract contract UserModule {
	// Event declarations
	event UserRegistered(
		uint256 indexed userId,
		address indexed userAddress,
		uint256 indexed referrerId
	);
	event ReferralAdded(uint256 indexed referrerId, uint256 indexed referralId);

	/// @custom:storage-location erc7201:userModule.storage
	struct UserStorage {
		uint256 userCount;
		mapping(address => User) users;
		mapping(uint256 => address) userIdToAddress;
	}
	// keccak256(abi.encode(uint256(keccak256("userModule.storage")) - 1)) & ~bytes32(uint256(0xff));
	bytes32 private constant USER_STORAGE_LOCATION =
		0x0038ec5cf8f0d1747ebb72ff0e651cf1b10ea4f74874fe0bde352ae49428c500;

	// Accessor for the namespaced storage slot
	function _getUserStorage() private pure returns (UserStorage storage $) {
		assembly {
			$.slot := USER_STORAGE_LOCATION
		}
	}

	/// @notice Internal function to create or get the user ID.
	/// @param userAddr The address of the user.
	/// @param referrerId The ID of the referrer.
	/// @return userId The ID of the user.
	function _createOrGetUserId(
		address userAddr,
		uint256 referrerId
	) internal returns (uint256 userId) {
		bool isNewUser;
		bool isRefAdded;
		(userId, isNewUser, isRefAdded) = UserModuleLib.createOrGetUserId(
			_getUserStorage(),
			userAddr,
			referrerId
		);

		if (isRefAdded) emit ReferralAdded(referrerId, userId);

		if (isNewUser) emit UserRegistered(userId, userAddr, referrerId);
	}

	/// @notice Gets the user ID for a given address.
	/// @param userAddress The address of the user.
	/// @return userId The ID of the user.
	function getUserId(
		address userAddress
	) external view returns (uint256 userId) {
		return _getUserStorage().users[userAddress].id;
	}

	function userIdToAddress(uint256 id) public view returns (address) {
		return _getUserStorage().userIdToAddress[id];
	}

	function totalUsers() external view returns (uint256) {
		return _getUserStorage().userCount;
	}

	// function getReferrer(
	// 	address userAddress
	// ) public view returns (uint256 referrerId, address referrerAddress) {
	// 	(referrerId, referrerAddress) = UserModuleLib.getReferrer(
	// 		_getUserStorage(),
	// 		userAddress
	// 	);
	// }

	function getReferrals(
		address userAddress
	) external view returns (ReferralInfo[] memory) {
		return UserModuleLib.getReferrals(_getUserStorage(), userAddress);
	}
}
