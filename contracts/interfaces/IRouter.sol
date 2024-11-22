// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { TokenPayment } from "../libraries/TokenPayments.sol";

interface IRouter {
	function createPair(
		TokenPayment calldata paymentA,
		TokenPayment calldata paymentB
	) external payable returns (address pairAddress, uint256 gTokenNonce);

	function addLiquidity(
		TokenPayment memory paymentA,
		TokenPayment memory paymentB,
		uint amountAMin,
		uint amountBMin,
		uint deadline
	)
		external
		payable
		returns (uint amountA, uint amountB, uint liquidity, address pair);

	function getWrappedNativeToken() external view returns (address);

	function getPairsBeacon() external view returns (address);
}
