// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "../../lib/forge-std/src/Test.sol";
import { Pair } from "../Pair.sol";
import { TestERC20 } from "./TestERC20.sol";
import { AMMLibrary } from "../libraries/AMMLibrary.sol";

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

	function testFuzz_swap(bool isToken0In, uint256 amountIn) public {
		uint256 amount0Out = 0;
		uint256 amount1Out = 0;
		// Random address for the swap
		address to = 0x5B38Da6a701c568545dCfcB03FcB875f56beddC4;

		// Ensure the amounts are within a reasonable range
		amountIn = bound(amountIn, 0.000_001 ether, 1000 ether);

		// Mint tokens to the Pair contract
		(uint256 reserve0, uint256 reserve1, ) = pair.getReserves();

		if (isToken0In) {
			token0.mint(address(pair), amountIn);
			amount1Out = AMMLibrary.getAmountOut(amountIn, reserve0, reserve1);
		} else {
			token1.mint(address(pair), amountIn);
			amount0Out = AMMLibrary.getAmountOut(amountIn, reserve1, reserve0);
		}

		// Call the swap function
		pair.swap(amount0Out, amount1Out, to);

		// Check the reserves
		(uint256 reserve0Final, uint256 reserve1Final, ) = pair.getReserves();

		if (isToken0In) {
			assert(token1.balanceOf(to) == amount1Out);
			assert(reserve0Final == reserve0 + amountIn);
			assert(reserve1Final == reserve1 - amount1Out);
		} else {
			assert(token0.balanceOf(to) == amount0Out);
			assert(reserve0Final == reserve0 - amount0Out);
			assert(reserve1Final == reserve1 + amountIn);
		}
	}
}
