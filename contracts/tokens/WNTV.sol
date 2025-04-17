// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title WNTV (Delegated EDU)
/// @notice GainzSwap's delegated EDU staking mechanism. Also powers EDU liquidity on the DEX
contract WNTV is ERC20Upgradeable, OwnableUpgradeable {
	// ----------------------------------
	// EVENTS
	// ----------------------------------

	/// @dev Emitted when a user deposits native tokens to receive WNTV.
	event Deposited(address indexed user, uint256 amount);

	/// @dev Emitted when a user initiates a withdrawal.
	event WithdrawalRequested(
		address indexed user,
		uint256 amount,
		uint256 readyTimestamp
	);

	/// @dev Emitted when a user completes a withdrawal.
	event WithdrawalCompleted(address indexed user, uint256 amount);

	/// @dev Emitted when Yuzu aggregator is updated.
	event YuzuAggregatorUpdated(address indexed aggregator);

	// ----------------------------------
	// STRUCTS & STORAGE
	// ----------------------------------

	struct UserWithdrawal {
		uint256 amount;
		uint256 readyTimestamp;
	}

	/// @custom:storage-location erc7201:gainz.tokens.WNTV.storage
	struct WNTVStore {
		address payable yuzuAggregator;
		mapping(address => UserWithdrawal) withdrawals;
		uint256 pendingWithdrawals;
	}

	/// @dev Storage slot constant for upgradeable storage layout
	bytes32 private constant WNTV_STORAGE_SLOT =
		0x9c939a4b05ceda8b86db186f0245ad77465dc7a372c22a1f429a973574185700;

	function _getWNTVStorage() private pure returns (WNTVStore storage $) {
		assembly {
			$.slot := WNTV_STORAGE_SLOT
		}
	}

	// ----------------------------------
	// INITIALIZATION
	// ----------------------------------

	/// @notice Initializes the contract and sets token metadata.
	function initialize(address initialOwner) public initializer {
		__ERC20_init("Delegated EDU", "dEDU");
		__Ownable_init(initialOwner);
	}

	// ----------------------------------
	// OWNER-ONLY FUNCTIONS
	// ----------------------------------

	/// @notice Sets the Yuzu aggregator address.
	function setYuzuAggregator(address _yuzuAggregator) external onlyOwner {
		_getWNTVStorage().yuzuAggregator = payable(_yuzuAggregator);
		emit YuzuAggregatorUpdated(_yuzuAggregator);
	}

	/// @notice Allows the contract owner to withdraw ETH balance.
	function withdrawETHBalance(address payable to) external onlyOwner {
		uint256 balance = address(this).balance;
		require(balance > 0, "No ETH to withdraw");

		(bool success, ) = to.call{ value: balance }("");
		require(success, "ETH withdraw failed");
	}

	// ----------------------------------
	// PUBLIC / EXTERNAL FUNCTIONS
	// ----------------------------------

	/// @notice Deposits native tokens and approves a spender to use them.
	function receiveForSpender(address owner, address spender) public payable {
		_stakeEDU(owner);
		_approve(owner, spender, msg.value);
	}

	/// @notice Deposits native tokens and mints WNTV tokens for the sender.
	function receiveFor(address owner) public payable {
		_stakeEDU(owner);
	}

	/// @notice Initiates a withdrawal request for WNTV tokens.
	function withdraw(uint256 amount) public {
		require(balanceOf(msg.sender) >= amount, "WNTV: Insufficient balance");
		_burn(msg.sender, amount);

		UserWithdrawal storage withdrawal = _getWNTVStorage().withdrawals[
			msg.sender
		];
		withdrawal.readyTimestamp =
			block.timestamp -
			(block.timestamp % 1 days) +
			2 days;
		withdrawal.amount += amount;

		_getWNTVStorage().pendingWithdrawals += amount;
		emit WithdrawalRequested(msg.sender, amount, withdrawal.readyTimestamp);
	}

	/// @notice Completes a matured withdrawal.
	function completeWithdrawal() external {
		UserWithdrawal storage withdrawal = _getWNTVStorage().withdrawals[
			msg.sender
		];
		require(
			withdrawal.readyTimestamp <= block.timestamp,
			"Withdrawal not ready"
		);

		uint256 amount = withdrawal.amount;
		delete _getWNTVStorage().withdrawals[msg.sender];

		(bool success, ) = payable(msg.sender).call{ value: amount }("");
		require(success, "EDU transfer failed");

		emit WithdrawalCompleted(msg.sender, amount);
	}

	/// @notice Settles pending withdrawals by reducing the pending amount.
	function settleWithdrawals() external payable {
		_getWNTVStorage().pendingWithdrawals -= msg.value;
	}

	/// @notice Allows direct deposits of native tokens.
	receive() external payable {
		_stakeEDU(msg.sender);
	}

	// ----------------------------------
	// INTERNAL FUNCTIONS
	// ----------------------------------

	/// @dev Stakes native tokens with the Yuzu aggregator and mints WNTV tokens.
	function _stakeEDU(address depositor) internal {
		address yuzuAggregator_ = _getWNTVStorage().yuzuAggregator;
		require(yuzuAggregator_ != address(0), "yuzuAggregator not set");

		(bool success, ) = yuzuAggregator_.call{ value: msg.value }("");
		require(success, "Failed to stake for Yuzu");

		_mint(depositor, msg.value);
		emit Deposited(depositor, msg.value);
	}

	// ----------------------------------
	// VIEW FUNCTIONS
	// ----------------------------------

	/// @notice Returns the address of the Yuzu aggregator.
	function yuzuAggregator() external view returns (address) {
		return _getWNTVStorage().yuzuAggregator;
	}

	/// @notice Returns the total pending withdrawals.
	function pendingWithdrawals() external view returns (uint256) {
		return _getWNTVStorage().pendingWithdrawals;
	}

	/// @notice Returns a user's pending withdrawals.
	function userPendingWithdrawals(
		address user
	) external view returns (UserWithdrawal memory) {
		return _getWNTVStorage().withdrawals[user];
	}
}
