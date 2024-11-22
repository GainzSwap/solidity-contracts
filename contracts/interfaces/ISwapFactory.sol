// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

interface ISwapFactory {
	error IdenticalAddress();
	error ZeroAddress();
	error PairExists();

	event PairCreated(
		address indexed token0,
		address indexed token1,
		address pair,
		uint256
	);

	function feeTo() external view returns (address);

	function feeToSetter() external view returns (address);

	function getPair(
		address tokenA,
		address tokenB
	) external view returns (address pair);

	function allPairs(uint256) external view returns (address pair);

	function allPairsLength() external view returns (uint);

	function setFeeTo(address) external;

	function setFeeToSetter(address) external;
}
