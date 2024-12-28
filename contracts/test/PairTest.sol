// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Pair } from "../Pair.sol";
import { TestERC20 } from "./TestERC20.sol";
import { AMMLibrary } from "../libraries/AMMLibrary.sol";

import "forge-std/console.sol";

contract PairTest is Test {
	Pair pair;
	TestERC20 token0;
	TestERC20 token1;

	function setUp() public {
		// Deploy mock TestERC20 tokens
		token0 = new TestERC20("Token0", "TK0", 18);
		token1 = new TestERC20("Token1", "TK1", 5);

		// Deploy the Pair contract
		pair = new Pair();
		pair.initialize(address(token0), address(token1));

		// Mint some tokens to the test contract
		token0.mint(address(pair), 1000 ether);
		token1.mint(address(pair), 1000 ether);

		pair.mint(address(this));
	}

	function feeTo() public pure returns (address) {
		return 0x5B38Da6a701c568545dCfcB03FcB875f56beddC4;
	}

	function testFuzz_swap(bool isToken0In, uint256 amountIn) public {
		uint256[2] memory feeData0;
		uint256[2] memory feeData1;
		// Random address for the swap
		address swapReceiver = 0x5B38Da6a701c568545dCfcB03FcB875f56beddC4;
		(uint256 reserve0, uint256 reserve1, ) = pair.getReserves();

		// Ensure the amounts are within a reasonable range
		amountIn = bound(
			amountIn,
			10_000 wei,
			(isToken0In ? reserve0 : reserve1) * 1_000
		);

		if (isToken0In) {
			token0.mint(address(pair), amountIn);
			feeData1 = AMMLibrary.getAmountOut(
				amountIn,
				reserve0,
				reserve1,
				address(pair)
			);
		} else {
			token1.mint(address(pair), amountIn);
			feeData0 = AMMLibrary.getAmountOut(
				amountIn,
				reserve1,
				reserve0,
				address(pair)
			);
		}

		// Call the swap function
		pair.swap(
			feeData0[0],
			feeData0[1],
			feeData1[0],
			feeData1[1],
			swapReceiver
		);

		// Check the reserves
		(uint256 reserve0Final, uint256 reserve1Final, ) = pair.getReserves();

		(
			uint256 receiverBalance,
			uint256 reserveInDelta,
			uint256 amountOut
		) = isToken0In
				? (
					token1.balanceOf(swapReceiver),
					reserve0 + amountIn,
					feeData1[0]
				)
				: (
					token0.balanceOf(swapReceiver),
					reserve1 + amountIn,
					feeData0[0]
				);
		uint256 reserveOutDelta = (isToken0In ? reserve1 : reserve0) -
			amountOut;

		assertEq(receiverBalance, amountOut, "Balance Error");
		assertEq(
			reserveInDelta,
			isToken0In ? reserve0Final : reserve1Final,
			"reserveInDelta Error"
		);
		assertEq(
			reserveOutDelta,
			isToken0In ? reserve1Final : reserve0Final,
			"ReserveOutDelta Error"
		);

		// Mints fee Liquidity
		assertTrue(
			pair.balanceOf(feeTo()) > 0,
			"Fee Collector should receive fee in liquidity"
		);
	}

	function testFuzz_mint(uint amount0, uint amount1) public {
		(uint reserve0, uint reserve1, ) = pair.getReserves();

		amount0 = bound(amount0, reserve0 / 100, reserve0);
		amount1 = bound(amount1, reserve1 / 100, reserve1);

		token0.mint(address(pair), amount0);
		token1.mint(address(pair), amount1);

		pair.mint(address(this));

		token0.mint(address(pair), amount0 / 10);
		token1.mint(address(pair), amount1 * 100);

		pair.mint(address(this));
	}
}
