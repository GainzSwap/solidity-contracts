// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

function isERC20(address tokenAddress) returns (bool) {
	if (address(0) == tokenAddress) {
		return false;
	}

	(bool success, bytes memory name) = tokenAddress.call(
		abi.encodeWithSignature("name()")
	);
	require(success, "Unable to check low level call for token address");

	return name.length > 0;
}
