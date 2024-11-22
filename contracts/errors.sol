// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract Errors {
	error InvalidPath(address[] path);
	error InSufficientOutputAmount(address[] path, uint256 amount);
}
