// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Pair } from "../Pair.sol";
import { TestERC20 } from "./TestERC20.sol";
import { AMMLibrary } from "../libraries/AMMLibrary.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

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

		address swapReceiver = makeAddr("receiver");
		(uint256 reserve0, uint256 reserve1, ) = pair.getReserves();

		// Bound amountIn to avoid overflow or unreasonably large inputs
		amountIn = bound(
			amountIn,
			10_000 wei,
			(isToken0In ? reserve0 : reserve1) * 1_000
		);

		uint256 netOut;
		{
			uint256 FEE_BASIS_POINTS = pair.FEE_BASIS_POINTS();

			if (isToken0In) {
				token0.mint(address(pair), amountIn);
				feeData1 = AMMLibrary.getAmountOut(
					amountIn,
					reserve0,
					reserve1,
					address(pair)
				);
				uint256 amountOut = feeData1[0];
				uint256 feePercent = feeData1[1];
				netOut =
					(amountOut * (FEE_BASIS_POINTS - feePercent)) /
					FEE_BASIS_POINTS;
			} else {
				token1.mint(address(pair), amountIn);
				feeData0 = AMMLibrary.getAmountOut(
					amountIn,
					reserve1,
					reserve0,
					address(pair)
				);
				uint256 amountOut = feeData0[0];
				uint256 feePercent = feeData0[1];
				netOut =
					(amountOut * (FEE_BASIS_POINTS - feePercent)) /
					FEE_BASIS_POINTS;
			}
		}
		// Perform the swap
		pair.swap(feeData0[0], feeData1[0], swapReceiver);

		(uint256 reserve0Final, uint256 reserve1Final, ) = pair.getReserves();

		// Ensure receiver got the net output after fees
		uint256 receiverBalance = isToken0In
			? token1.balanceOf(swapReceiver)
			: token0.balanceOf(swapReceiver);

		assertEq(receiverBalance, netOut, "Receiver received incorrect netOut");

		// Check final reserve changes
		uint256 expectedReserveIn = (isToken0In ? reserve0 : reserve1) +
			amountIn;
		uint256 expectedReserveOut = (isToken0In ? reserve1 : reserve0) -
			netOut;

		assertEq(
			isToken0In ? reserve0Final : reserve1Final,
			expectedReserveIn,
			"ReserveIn mismatch"
		);
		assertEq(
			isToken0In ? reserve1Final : reserve0Final,
			expectedReserveOut,
			"ReserveOut mismatch"
		);

		// Fee LP token should be minted
		assertTrue(pair.balanceOf(feeTo()) > 0, "Fee liquidity was not minted");
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

	/// @notice Fuzz test for setFee within and beyond bounds
	function testSetFeeBounds(uint256 newMin, uint256 newMax) public {
		// bound to valid range
		newMin = bound(newMin, pair.MINIMUM_FEE(), pair.MAXIMUM_FEE());
		newMax = bound(newMax, newMin, pair.MAXIMUM_FEE());

		// valid update
		pair.setFee(newMin, newMax);
		(uint256 minF, uint256 maxF) = pair.feePercents();
		assertEq(minF, newMin);
		assertEq(maxF, newMax);

		// invalid: min below
		// vm.expectRevert("Pair: newMinFee < MINIMUM_FEE");
		// pair.setFee(pair.MINIMUM_FEE() - 1, newMax);

		// invalid: max above
		// vm.expectRevert("Pair: newMaxFee > MAXIMUM_FEE");
		// pair.setFee(newMin, pair.MAXIMUM_FEE() + 1);

		// invalid: min > max
		// vm.expectRevert("Pair: newMinFee > newMaxFee");
		// pair.setFee(newMax, newMin);

		// reset fee
		pair.resetFee();
		(minF, maxF) = pair.feePercents();
		assertEq(minF, pair.MINIMUM_FEE());
		assertEq(maxF, pair.MAXIMUM_FEE());
	}

	function testOnlyOwnerSetsFee(address attacker) public {
		vm.assume(attacker != address(0) && attacker != address(this));

		vm.prank(attacker);
		vm.expectRevert(
			abi.encodeWithSelector(
				OwnableUpgradeable.OwnableUnauthorizedAccount.selector,
				attacker
			)
		);
		pair.resetFee();

		vm.prank(attacker);
		vm.expectRevert(
			abi.encodeWithSelector(
				OwnableUpgradeable.OwnableUnauthorizedAccount.selector,
				attacker
			)
		);
		pair.setFee(10, 30);
	}
}
