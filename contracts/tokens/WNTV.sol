// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title WNTV (Delegated EDU)
/// @notice GainzSwap's delegated EDU staking mechanism. Also powers EDU liquidity on the DEX
/// @dev Now includes quadratic emission scaling based on total supply vs. target supply.
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

	/// @dev Emitted when target supply is updated for emission scaling.
	event TargetSupplyUpdated(uint256 newTarget);

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
		uint256 targetSupply; // Target total supply for quadratic emission scaling
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

	/// @notice Sets the target supply to be used in quadratic emission calculations.
	/// @param newTarget The new target supply value (must be > 0).
	function setTargetSupply(uint256 newTarget) external onlyOwner {
		require(newTarget > 0, "Target must be > 0");
		_getWNTVStorage().targetSupply = newTarget;
		emit TargetSupplyUpdated(newTarget);
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

	/**
	 * @notice Scales an amount based on current dEDU supply and target supply.
	 *         Uses a logarithmic bonding curve that increases steeply as supply grows.
	 * @param amount The base amount to distribute.
	 * @param totalSupply The current total supply of dEDU.
	 * @param targetSupply The target supply for maximum emission.
	 * @return scaled The scaled emission amount, always ≤ amount.
	 */
	function _scaledEmission(
		uint256 amount,
		uint256 totalSupply,
		uint256 targetSupply
	) internal pure returns (uint256 scaled) {
		if (totalSupply == 0 || targetSupply == 0) return 0;

		uint256 ratio = (totalSupply * 1e18) / targetSupply;

		// Clamp ratio to a max of 1e18 (100%) to avoid overflow in log2
		if (ratio > 1e18) ratio = 1e18;

		// Use log2-based bonding curve: log2(ratio * 2) * factor
		// This makes the curve steep and smooth
		uint256 logInput = Math.max(ratio * 2, 1); // ensure ≥ 1
		uint256 weight = Math.log2(logInput); // in base 2, scaled by 1e18
		scaled = (amount * weight) / Math.log2(2e18); // normalize by max (log2(2))
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

	/// @notice Returns the configured target supply for scaling emissions.
	function getTargetSupply() external view returns (uint256) {
		return _getWNTVStorage().targetSupply;
	}

	function scaleEmission(
		uint256 amount
	) external view returns (uint256 scaled) {
		WNTVStore storage $ = _getWNTVStorage();
		uint256 supply = totalSupply();
		uint256 target = $.targetSupply;

		scaled = _scaledEmission(amount, supply, target);
	}
}
