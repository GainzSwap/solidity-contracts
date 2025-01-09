// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IPair } from "./interfaces/IPair.sol";
import { ISwapFactory } from "./interfaces/ISwapFactory.sol";

import { Math } from "./libraries/Math.sol";
import { UQ112x112 } from "./libraries/UQ112x112.sol";
import { FullMath } from "./libraries/FullMath.sol";

import { PairERC20 } from "./abstracts/PairERC20.sol";

import "./types.sol";

contract Pair is IPair, PairERC20, OwnableUpgradeable {
	using UQ112x112 for uint224;

	uint constant MINIMUM_LIQUIDITY = 10 ** 3;

	uint constant FEE_BASIS_POINTS = 100_00; // 100%
	uint constant MINIMUM_FEE = 5; // 0.05%
	uint constant MAXIMUM_FEE = 500; // 5%

	bytes4 private constant SELECTOR =
		bytes4(keccak256(bytes("transfer(address,uint256)")));

	/// @custom:storage-location erc7201:gainz.Pair.storage
	struct PairStorage {
		address router;
		address token0;
		address token1;
		uint112 reserve0;
		uint112 reserve1;
		uint32 blockTimestampLast;
		uint price0CumulativeLast;
		uint price1CumulativeLast;
		uint kLast; // reserve0 * reserve1, as of immediately after the most recent liquidity event
		uint unlocked;
		uint minFee;
		uint maxFee;
	}
	// keccak256(abi.encode(uint256(keccak256("gainz.Pair.storage")) - 1)) & ~bytes32(uint256(0xff));
	bytes32 private constant PAIR_STORAGE_LOCATION =
		0x052a7ca952fd79e6951e1e37bbd8a7a728c978d413c271dcc4d73117e8490200;

	function _getPairStorage() private pure returns (PairStorage storage $) {
		assembly {
			$.slot := PAIR_STORAGE_LOCATION
		}
	}

	modifier lock() {
		PairStorage storage $ = _getPairStorage();

		require($.unlocked == 1, "Pair: LOCKED");
		$.unlocked = 0;
		_;
		$.unlocked = 1;
	}

	// called once by the router at time of deployment
	function initialize(address _token0, address _token1) external initializer {
		__Ownable_init(msg.sender);
		__PairERC20_init();

		PairStorage storage $ = _getPairStorage();

		$.router = msg.sender;
		$.token0 = _token0;
		$.token1 = _token1;
		$.unlocked = 1;
		$.minFee = MINIMUM_FEE;
		$.maxFee = MAXIMUM_FEE;
	}

	// update reserves and, on the first call per block, price accumulators
	function _update(
		uint balance0,
		uint balance1,
		uint112 reserve0,
		uint112 reserve1
	) private {
		PairStorage storage $ = _getPairStorage();

		require(
			balance0 <= type(uint112).max && balance1 <= type(uint112).max,
			"Pair: OVERFLOW"
		);

		uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);
		uint32 timeElapsed = blockTimestamp - $.blockTimestampLast; // Overflow is intentional here

		if (timeElapsed > 0 && reserve0 != 0 && reserve1 != 0) {
			// * never overflows, and + overflow is desired
			$.price0CumulativeLast +=
				uint(UQ112x112.encode(reserve1).uqdiv(reserve0)) *
				timeElapsed;
			$.price1CumulativeLast +=
				uint(UQ112x112.encode(reserve0).uqdiv(reserve1)) *
				timeElapsed;
		}

		$.reserve0 = uint112(balance0);
		$.reserve1 = uint112(balance1);
		$.blockTimestampLast = blockTimestamp;
		emit Sync($.reserve0, $.reserve1);
	}

	function router() external view returns (address) {
		return _getPairStorage().router;
	}

	function token0() external view returns (address) {
		return _getPairStorage().token0;
	}

	function token1() external view returns (address) {
		return _getPairStorage().token1;
	}

	function getReserves()
		public
		view
		returns (uint112 reserve0, uint112 reserve1, uint32 _blockTimestampLast)
	{
		PairStorage storage $ = _getPairStorage();

		reserve0 = $.reserve0;
		reserve1 = $.reserve1;
		_blockTimestampLast = $.blockTimestampLast;
	}

	function _safeTransfer(address token, address to, uint value) private {
		(bool success, bytes memory data) = token.call(
			abi.encodeWithSelector(SELECTOR, to, value)
		);
		require(
			success && (data.length == 0 || abi.decode(data, (bool))),
			"Pair: TRANSFER_FAILED"
		);
	}

	function price0CumulativeLast() external view returns (uint256) {
		return _getPairStorage().price0CumulativeLast;
	}

	function price1CumulativeLast() external view returns (uint256) {
		return _getPairStorage().price1CumulativeLast;
	}

	// this low-level function should be called from a contract which performs important safety checks
	function mint(address to) external lock onlyOwner returns (uint liquidity) {
		PairStorage storage $ = _getPairStorage();

		(uint112 reserve0, uint112 reserve1, ) = getReserves(); // gas savings
		uint balance0 = IERC20($.token0).balanceOf(address(this));
		uint balance1 = IERC20($.token1).balanceOf(address(this));
		uint amount0 = balance0 - reserve0;
		uint amount1 = balance1 - reserve1;

		uint _totalSupply = totalSupply();
		if (_totalSupply == 0) {
			liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
			_mint(address(0), MINIMUM_LIQUIDITY); // permanently lock the first MINIMUM_LIQUIDITY tokens
		} else {
			liquidity = Math.min(
				(amount0 * _totalSupply) / reserve0,
				(amount1 * _totalSupply) / reserve1
			);
		}
		require(liquidity > 0, "Pair: INSUFFICIENT_LIQUIDITY_MINTED");
		_mint(to, liquidity);

		_update(balance0, balance1, reserve0, reserve1);
		emit Mint(msg.sender, amount0, amount1);
	}

	// this low-level function should be called from a contract which performs important safety checks
	function burn(
		address to
	) external lock onlyOwner returns (uint amount0, uint amount1) {
		PairStorage storage $ = _getPairStorage();

		(uint112 _reserve0, uint112 _reserve1) = ($.reserve0, $.reserve1); // gas savings
		address _token0 = $.token0; // gas savings
		address _token1 = $.token1; // gas savings
		uint balance0 = IERC20(_token0).balanceOf(address(this));
		uint balance1 = IERC20(_token1).balanceOf(address(this));
		uint liquidity = balanceOf(address(this));

		uint _totalSupply = totalSupply();
		amount0 = (liquidity * balance0) / _totalSupply; // using balances ensures pro-rata distribution
		amount1 = (liquidity * balance1) / _totalSupply; // using balances ensures pro-rata distribution
		require(
			amount0 > 0 && amount1 > 0,
			"PairV2: INSUFFICIENT_LIQUIDITY_BURNED"
		);
		_burn(address(this), liquidity);
		_safeTransfer(_token0, to, amount0);
		_safeTransfer(_token1, to, amount1);
		balance0 = IERC20(_token0).balanceOf(address(this));
		balance1 = IERC20(_token1).balanceOf(address(this));

		_update(balance0, balance1, _reserve0, _reserve1);
		emit Burn(msg.sender, amount0, amount1, to);
	}

	// if fee is on, mint liquidity equivalent to feePercent charged from the swap
	function _mintSwapFee(
		uint112 _reserve0,
		uint112 _reserve1,
		uint feePercent
	) private returns (bool feeOn) {
		PairStorage storage $ = _getPairStorage();

		address feeTo = ISwapFactory($.router).feeTo();
		feeOn = feeTo != address(0);
		uint _kLast = $.kLast; // gas savings
		if (feeOn) {
			// We don't restrict to only when _kLast > 0 since all swaps generate fees
			uint rootK = Math.sqrt(uint(_reserve0) * (_reserve1));
			uint rootKLast = Math.sqrt(_kLast);
			if (rootK > rootKLast) {
				uint numerator = totalSupply() * (rootK - rootKLast);
				uint denominator = (rootK * feePercent) + (rootKLast);
				uint liquidity = numerator / denominator;
				if (liquidity > 0) _mint(feeTo, liquidity);
			}
		} else if (_kLast != 0) {
			$.kLast = 0;
		}
	}

	struct SwapVariables {
		uint balance0;
		uint balance1;
		uint112 reserve0;
		uint112 reserve1;
	}

	function swap(
		uint amount0Out,
		uint feePercent0,
		uint amount1Out,
		uint feePercent1,
		address to
	) external lock {
		require(
			amount0Out > 0 || amount1Out > 0,
			"GainzSwap: INSUFFICIENT_OUTPUT_AMOUNT"
		);

		SwapVariables memory swapVars;

		(swapVars.reserve0, swapVars.reserve1, ) = getReserves(); // gas savings
		require(
			amount0Out < swapVars.reserve0 && amount1Out < swapVars.reserve1,
			"GainzSwap: INSUFFICIENT_LIQUIDITY"
		);

		bool feeOn = _mintSwapFee(
			swapVars.reserve0,
			swapVars.reserve1,
			feePercent0 + feePercent1
		);

		PairStorage storage $ = _getPairStorage();

		{
			// scope for $.token{0,1}, avoids stack too deep errors
			require(to != $.token0 && to != $.token1, "GainzSwap: INVALID_TO");

			if (amount0Out > 0) _safeTransfer($.token0, to, amount0Out); // optimistically transfer tokens
			if (amount1Out > 0) _safeTransfer($.token1, to, amount1Out); // optimistically transfer tokens

			swapVars.balance0 = IERC20($.token0).balanceOf(address(this));
			swapVars.balance1 = IERC20($.token1).balanceOf(address(this));
		}

		uint amount0In = swapVars.balance0 > swapVars.reserve0 - amount0Out
			? swapVars.balance0 - (swapVars.reserve0 - amount0Out)
			: 0;
		uint amount1In = swapVars.balance1 > swapVars.reserve1 - amount1Out
			? swapVars.balance1 - (swapVars.reserve1 - amount1Out)
			: 0;
		require(
			amount0In > 0 || amount1In > 0,
			"GainzSwap: INSUFFICIENT_INPUT_AMOUNT"
		);

		{
			uint balance0Adjusted = (swapVars.balance0 * FEE_BASIS_POINTS) -
				(amount0In * feePercent0);

			uint balance1Adjusted = (swapVars.balance1 * FEE_BASIS_POINTS) -
				(amount1In * feePercent1);

			require(
				balance0Adjusted * balance1Adjusted >=
					uint(swapVars.reserve0) *
						uint(swapVars.reserve1) *
						FEE_BASIS_POINTS ** 2,
				"GainzSwap: K"
			);
		}

		_update(
			swapVars.balance0,
			swapVars.balance1,
			swapVars.reserve0,
			swapVars.reserve1
		);
		if (feeOn) $.kLast = uint($.reserve0) * ($.reserve1); // reserve0 and reserve1 are up-to-date

		emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
	}

	function sync() external {
		PairStorage storage $ = _getPairStorage();

		_update(
			IERC20($.token0).balanceOf(address(this)),
			IERC20($.token1).balanceOf(address(this)),
			$.reserve0,
			$.reserve1
		);
	}

	function calculateFeePercent(
		uint256 amount,
		uint256 reserve
	) public view returns (uint256 feePercent) {
		(uint256 reserve0, uint256 reserve1, ) = getReserves();

		require(
			reserve == reserve0 || reserve == reserve1,
			"GainzSwap: INVALID_RESERVE"
		);

		(uint256 minFeePercent, uint256 maxFeePercent) = feePercents();

		uint256 totalLiquidty = totalSupply() -
			balanceOf(ISwapFactory(_getPairStorage().router).feeTo());
		uint256 liquidity = (amount * totalLiquidty) / reserve;

		feePercent =
			minFeePercent +
			(liquidity * (maxFeePercent - minFeePercent)) /
			totalLiquidty;

		// Bounds the feePercent to the minFee and maxFee
		return feePercent > maxFeePercent ? maxFeePercent : feePercent;
	}

	function feePercents() public view returns (uint256, uint256) {
		PairStorage storage $ = _getPairStorage();

		return (
			$.minFee == 0 ? MINIMUM_FEE : $.minFee,
			$.maxFee == 0 ? MAXIMUM_FEE : $.maxFee
		);
	}
}
