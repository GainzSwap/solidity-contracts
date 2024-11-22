// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;
import { AMMLibrary } from "./libraries/AMMLibrary.sol";

contract Views {
	address public immutable router;
	address public immutable pairsBeacon;

	constructor(address _router, address _pairsBeacon) {
		router = _router;
		pairsBeacon = _pairsBeacon;
	}

	// **** AMM LIBRARY FUNCTIONS ****
	function quote(
		uint amountA,
		uint reserveA,
		uint reserveB
	) public pure virtual returns (uint amountB) {
		return AMMLibrary.quote(amountA, reserveA, reserveB);
	}

	function getAmountOut(
		uint amountIn,
		uint reserveIn,
		uint reserveOut
	) public pure virtual returns (uint amountOut) {
		return AMMLibrary.getAmountOut(amountIn, reserveIn, reserveOut);
	}

	function getAmountIn(
		uint amountOut,
		uint reserveIn,
		uint reserveOut
	) public pure virtual returns (uint amountIn) {
		return AMMLibrary.getAmountIn(amountOut, reserveIn, reserveOut);
	}

	function getAmountsOut(
		uint amountIn,
		address[] memory path
	) public view virtual returns (uint[] memory amounts) {
		return AMMLibrary.getAmountsOut(router, pairsBeacon, amountIn, path);
	}

	function getAmountsIn(
		uint amountOut,
		address[] memory path
	) public view virtual returns (uint[] memory amounts) {
		return AMMLibrary.getAmountsIn(router, pairsBeacon, amountOut, path);
	}
}
