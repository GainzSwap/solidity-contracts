// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

interface IWEDU {
	function deposit() external payable;

	function withdraw(uint256 wad) external;
}

/// @title WNTV (Wrapped Native Token)
/// @notice This contract wraps native tokens into ERC20-compliant WNTV tokens.
contract WNTV is ERC20Upgradeable, OwnableUpgradeable {
	/// @custom:storage-location erc7201:gainz.tokens.WNTV.storage
	struct WNTVStore {
		address payable wedu;
		mapping(address => bool) knownWedu;
	}

	// keccak256(abi.encode(uint256(keccak256("gainz.tokens.WNTV.storage")) - 1)) & ~bytes32(uint256(0xff))
	bytes32 private constant WNTV_STORAGE_SLOT =
		0x9c939a4b05ceda8b86db186f0245ad77465dc7a372c22a1f429a973574185700;

	function _getWNTVStorage() private pure returns (WNTVStore storage $) {
		assembly {
			$.slot := WNTV_STORAGE_SLOT
		}
	}

	/// @notice Constructor initializes the ERC20Upgradeable token with name and symbol.
	function initialize() public initializer {
		__ERC20_init("Wrapped Native Token", "WNTV");
	}

	/// @dev Sets the owner after upgrading only once
	function setup() external {
		require(owner() == address(0), "Already set");
		_transferOwnership(msg.sender);
	}

	function setWEDU(address _wedu) external onlyOwner {
		_getWNTVStorage().wedu = payable(_wedu);
		_getWNTVStorage().knownWedu[_wedu] = true;
	}

	/// @notice Unwraps WNTV tokens back into native tokens.
	/// @param amount The amount of WNTV tokens to unwrap.
	/// @dev This function burns the specified amount of WNTV tokens and sends the equivalent amount of native tokens to the user.
	function withdraw(uint256 amount) public {
		require(balanceOf(msg.sender) >= amount, "WNTV: Insufficient balance");
		_burn(msg.sender, amount);

		IWEDU(_getWNTVStorage().wedu).withdraw(amount);
		payable(msg.sender).transfer(amount);
	}

	/// @notice Allows an approved spender to use WNTV tokens on behalf of the sender.
	/// @param owner The address of the token owner.
	/// @param spender The address of the spender allowed to use the tokens.
	/// @dev This function mints WNTV tokens to the owner and approves the spender to use the minted tokens.
	function receiveForSpender(address owner, address spender) public payable {
		_stakeEDU(owner);

		_approve(owner, spender, msg.value);
	}

	/// @notice Wraps native tokens into WNTV tokens for `owner`. The amount of WNTV minted equals the amount of native tokens sent.
	/// @param owner The address of the token owner.
	/// @dev This function mints WNTV tokens equivalent to the amount of native tokens sent by the user.
	function receiveFor(address owner) public payable {
		_stakeEDU(owner);
	}

	/// @dev early returns if @param depositor is/was a WEDU address or is this contract
	/// @param depositor the address to stake for
	function _stakeEDU(address depositor) internal {
		IWEDU(_getWNTVStorage().wedu).deposit{ value: address(this).balance }();

		if (depositor == address(this)) return;

		_mint(depositor, msg.value);
	}

	function wedu() external view returns (address) {
		return _getWNTVStorage().wedu;
	}

	receive() external payable {}
}
