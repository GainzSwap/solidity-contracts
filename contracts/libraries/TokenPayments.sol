// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import { SFT } from "../abstracts/SFT.sol";
import { dEDU } from "../tokens/WNTV.sol";

import "hardhat/console.sol";

struct TokenPayment {
	address token;
	uint256 amount;
	uint256 nonce;
}

library TokenPayments {
	using Address for address;

	function receiveSFT(TokenPayment memory payment) internal {
		// SFT payment
		SFT(payment.token).safeTransferFrom(
			msg.sender,
			address(this),
			payment.nonce,
			payment.amount,
			""
		);
	}

	function receiveTokenFor(
		TokenPayment memory payment,
		address from,
		address to,
		address wNTV
	) internal {
		if (payment.token == address(0)) {
			// Wrap native tokens for `to`
			dEDU(payable(wNTV)).receiveFor{ value: payment.amount }(to);
		} else if (payment.nonce == 0) {
			// ERC20 payment
			// bytes4(keccak256(bytes('transferFrom(address,address,uint256)')));
			(bool success, bytes memory data) = payment.token.call(
				abi.encodeWithSelector(0x23b872dd, from, to, payment.amount)
			);
			require(
				success && (data.length == 0 || abi.decode(data, (bool))),
				"TokenPayments: transferFrom failed"
			);
		} else {
			// SFT payment
			SFT(payment.token).safeTransferFrom(
				from,
				to,
				payment.nonce,
				payment.amount,
				""
			);
		}
	}

	function sendFungibleToken(
		address token,
		uint256 amount,
		address to
	) internal {
		// bytes4(keccak256(bytes('transfer(address,uint256)')));
		(bool success, bytes memory data) = token.call(
			abi.encodeWithSelector(0xa9059cbb, to, amount)
		);
		require(
			success && (data.length == 0 || abi.decode(data, (bool))),
			"TokenPayments: sendFungibleToken failed"
		);
	}

	function sendToken(TokenPayment memory payment, address to) internal {
		if (payment.nonce == 0) {
			sendFungibleToken(payment.token, payment.amount, to);
		} else {
			// SFT payment
			SFT(payment.token).safeTransferFrom(
				address(this),
				to,
				payment.nonce,
				payment.amount,
				""
			);
		}
	}

	function approve(TokenPayment memory payment, address to) internal {
		if (payment.nonce == 0) {
			// ERC20 approval
			IERC20(payment.token).approve(to, payment.amount);
		} else {
			// SFT approval
			SFT(payment.token).setApprovalForAll(to, true);
		}
	}
}
