// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20BurnableUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { GainzInfo } from "./GainzInfo.sol";
import { GainzEmission } from "./GainzEmission.sol";

import { Epochs } from "../../libraries/Epochs.sol";

import { Router } from "../../Router.sol";

/**
 * @title Gainz
 * @dev ERC20Upgradeable token representing the Academy-DEX base token. This token is mintable only upon deployment,
 * with the total supply set to the maximum defined in the `GainzInfo` library. The token is burnable
 * and is controlled by the owner of the contract.
 */
contract Gainz is
	ERC20Upgradeable,
	ERC20BurnableUpgradeable,
	OwnableUpgradeable
{
	using Epochs for Epochs.Storage;

	/// @custom:storage-location erc7201:gainz.GainzERC20.storage
	struct GainzERC20Storage {
		Epochs.Storage epochs;
		uint256 lastTimestamp;
		address governance;
	}

	// keccak256(abi.encode(uint256(keccak256("gainz.GainzERC20.storage")) - 1)) & ~bytes32(uint256(0xff));
	bytes32 private constant GainzERC20_STORAGE_LOCATION =
		0x134accceb8ccd8549f1b5f4bf51d65d2512a1d4b87f29353424fe2bf01de7f00;

	function _getGainzERC20Storage()
		private
		pure
		returns (GainzERC20Storage storage $)
	{
		assembly {
			$.slot := GainzERC20_STORAGE_LOCATION
		}
	}

	/**
	 * @dev Initializes the ERC20Upgradeable token with the name "Gainz Token" and symbol "Gainz".
	 * Mints the maximum supply of tokens to the contract owner.
	 */
	function initialize() public initializer {
		__ERC20_init("Gainz Token", "Gainz");
		// Mint the maximum supply to the contract owner.
		_mint(msg.sender, GainzInfo.ICO_FUNDS);
		_mint(address(this), GainzInfo.ECOSYSTEM_DISTRIBUTION_FUNDS);
	}

	function runInit(address governance) external {
		GainzERC20Storage storage $ = _getGainzERC20Storage(); // Access namespaced storage
		require(governance != address(0), "Invalid Address");

		$.lastTimestamp = block.timestamp;
		$.governance = governance;
		(bool success, bytes memory epochData) = $.governance.call(
			abi.encodeWithSignature("epochs()")
		);

		require(success, "Invalid Governance");
		$.epochs = abi.decode(epochData, (Epochs.Storage));
	}

	function _computeEdgeEmissions(
		uint256 epoch,
		uint256 lastTimestamp,
		uint256 currentTimestamp
	) internal view returns (uint256) {
		require(
			currentTimestamp > lastTimestamp,
			"Router._computeEdgeEmissions: Invalid currentTimestamp"
		);

		GainzERC20Storage storage $ = _getGainzERC20Storage(); // Access namespaced storage

		(uint256 startTimestamp, uint256 endTimestamp) = $
			.epochs
			.epochEdgeTimestamps(epoch);

		uint256 upperBoundTime = 0;
		uint256 lowerBoundTime = 0;

		if (
			startTimestamp <= currentTimestamp &&
			currentTimestamp <= endTimestamp
		) {
			upperBoundTime = currentTimestamp;
			lowerBoundTime = lastTimestamp <= startTimestamp
				? startTimestamp
				: lastTimestamp;
		} else if (
			startTimestamp <= lastTimestamp && lastTimestamp <= endTimestamp
		) {
			upperBoundTime = currentTimestamp <= endTimestamp
				? currentTimestamp
				: endTimestamp;
			lowerBoundTime = lastTimestamp;
		} else {
			revert("Router._computeEdgeEmissions: Invalid timestamps");
		}

		return
			GainzEmission.throughTimeRange(
				epoch,
				upperBoundTime - lowerBoundTime,
				$.epochs.epochLength
			);
	}

	function _generateEmission()
		private
		view
		returns (uint256 lastTimestamp, uint256 _gainzToEmit)
	{
		GainzERC20Storage storage $ = _getGainzERC20Storage();
		Epochs.Storage storage epochs = $.epochs;

		uint256 currentTimestamp = block.timestamp;
		lastTimestamp = $.lastTimestamp;

		if (lastTimestamp < currentTimestamp) {
			uint256 lastGenerateEpoch = epochs.computeEpoch(lastTimestamp);
			_gainzToEmit = _computeEdgeEmissions(
				lastGenerateEpoch,
				lastTimestamp,
				currentTimestamp
			);

			uint256 currentEpoch = epochs.currentEpoch();
			if (currentEpoch > lastGenerateEpoch) {
				uint256 intermediateEpochs = currentEpoch -
					lastGenerateEpoch -
					1;

				if (intermediateEpochs > 1) {
					_gainzToEmit += GainzEmission.throughEpochRange(
						lastGenerateEpoch,
						lastGenerateEpoch + intermediateEpochs
					);
				}

				_gainzToEmit += _computeEdgeEmissions(
					currentEpoch,
					lastTimestamp,
					currentTimestamp
				);
			}

			lastTimestamp = currentTimestamp;
		}
	}

	function mintGainz() external {
		GainzERC20Storage storage $ = _getGainzERC20Storage();
		uint _gainzToEmit;
		($.lastTimestamp, _gainzToEmit) = _generateEmission();

		if (_gainzToEmit == 0) {
			return;
		}

		_transfer(address(this), $.governance, _gainzToEmit);
		(bool success, ) = $.governance.call(
			abi.encodeWithSignature("updateRewardReserve()")
		);

		require(success, "Unable to mint");
	}

	function gainzToEmit() public view returns (uint toEmit) {
		(, toEmit) = _generateEmission();
	}
}
