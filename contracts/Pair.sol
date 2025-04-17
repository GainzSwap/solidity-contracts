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

/// @title Pair (Modified UniswapV2Pair)
/// @notice Core AMM pair contract with configurable fee and TWAP support
contract Pair is IPair, PairERC20, OwnableUpgradeable {
	using UQ112x112 for uint224;

	// ──────────────────────────────────────────────
	// 🔒 Constants
	// ──────────────────────────────────────────────

	/// @notice Permanently locked minimum liquidity
	uint public constant MINIMUM_LIQUIDITY = 10 ** 3;

	/// @notice Base points denominator (100%)
	uint public constant FEE_BASIS_POINTS = 100_00;

	/// @notice Minimum fee (0.05%)
	uint public constant MINIMUM_FEE = 5;

	/// @notice Maximum fee (0.35%)
	uint public constant MAXIMUM_FEE = 35;

	/// @dev ERC20 `transfer(address,uint256)` selector
	bytes4 private constant SELECTOR =
		bytes4(keccak256("transfer(address,uint256)"));

	// ──────────────────────────────────────────────
	// 🧱 Storage (ERC7201)
	// ──────────────────────────────────────────────

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
		uint kLast; // reserve0 * reserve1, post-liquidity-event
		uint unlocked; // re-entrancy guard
		uint minFee; // current minimum fee (basis points)
		uint maxFee; // current maximum fee (basis points)
	}

	// keccak256(abi.encode(uint256(keccak256("gainz.Pair.storage")) - 1)) & ~bytes32(uint256(0xff));
	bytes32 private constant PAIR_STORAGE_LOCATION =
		0x052a7ca952fd79e6951e1e37bbd8a7a728c978d413c271dcc4d73117e8490200;

	/// @dev Returns the contract’s storage struct
	function _getPairStorage() private pure returns (PairStorage storage $) {
		assembly {
			$.slot := PAIR_STORAGE_LOCATION
		}
	}

	// ──────────────────────────────────────────────
	// 🚦 Modifiers
	// ──────────────────────────────────────────────

	/// @dev Re-entrancy guard
	modifier lock() {
		PairStorage storage $ = _getPairStorage();
		require($.unlocked == 1, "Pair: LOCKED");
		$.unlocked = 0;
		_;
		$.unlocked = 1;
	}

	// ──────────────────────────────────────────────
	// 🛠 Initialisation
	// ──────────────────────────────────────────────

	/// @notice Called once by the factory/router to set up pair
	/// @param _token0 The first ERC20 token
	/// @param _token1 The second ERC20 token
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

	// ──────────────────────────────────────────────
	// 📈 Internal Functions
	// ──────────────────────────────────────────────

	/// @dev Updates reserves and price cumulatives, emits `Sync`
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
		uint32 timeElapsed = blockTimestamp - $.blockTimestampLast; // overflow ok

		if (timeElapsed > 0 && reserve0 != 0 && reserve1 != 0) {
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

	/// @dev Safe ERC20 transfer: reverts on failure
	function _safeTransfer(address token, address to, uint value) private {
		(bool success, bytes memory data) = token.call(
			abi.encodeWithSelector(SELECTOR, to, value)
		);
		require(
			success && (data.length == 0 || abi.decode(data, (bool))),
			"Pair: TRANSFER_FAILED"
		);
	}

	/// @dev Compute net output amount after fee deduction
	function _getEffectiveAmountOut(
		uint rawAmount,
		uint reserve
	) internal view returns (uint netAmount, uint feePercent) {
		if (rawAmount == 0) return (rawAmount, 0);

		feePercent = calculateFeePercent(rawAmount, reserve);
		netAmount =
			(rawAmount * (FEE_BASIS_POINTS - feePercent)) /
			FEE_BASIS_POINTS;
	}

	// ──────────────────────────────────────────────
	// 🤝 Owner‑Only Fee Controls
	// ──────────────────────────────────────────────

	/// @dev Emitted when min/max fee are updated
	event FeeUpdated(uint minFee, uint maxFee);

	/// @notice Update the fee bounds
	/// @param newMinFee Minimum basis points (≥ MINIMUM_FEE)
	/// @param newMaxFee Maximum basis points (≤ MAXIMUM_FEE)
	function setFee(uint newMinFee, uint newMaxFee) external onlyOwner {
		require(newMinFee >= MINIMUM_FEE, "Pair: newMinFee < MINIMUM_FEE");
		require(newMaxFee <= MAXIMUM_FEE, "Pair: newMaxFee > MAXIMUM_FEE");
		require(newMinFee <= newMaxFee, "Pair: newMinFee > newMaxFee");

		PairStorage storage $ = _getPairStorage();
		$.minFee = newMinFee;
		$.maxFee = newMaxFee;
		emit FeeUpdated(newMinFee, newMaxFee);
	}

	/// @notice Reset fee bounds to defaults
	function resetFee() external onlyOwner {
		PairStorage storage $ = _getPairStorage();
		$.minFee = MINIMUM_FEE;
		$.maxFee = MAXIMUM_FEE;
		emit FeeUpdated(MINIMUM_FEE, MAXIMUM_FEE);
	}

	// ──────────────────────────────────────────────
	// 💧 Liquidity Management
	// ──────────────────────────────────────────────

	/// @notice Mint liquidity tokens to `to`
	/// @dev Caller must be router; uses `lock` guard
	/// @return liquidity Amount of LP minted
	function mint(address to) external lock onlyOwner returns (uint liquidity) {
		PairStorage storage $ = _getPairStorage();
		(uint112 reserve0, uint112 reserve1, ) = getReserves();
		uint balance0 = IERC20($.token0).balanceOf(address(this));
		uint balance1 = IERC20($.token1).balanceOf(address(this));
		uint amount0 = balance0 - reserve0;
		uint amount1 = balance1 - reserve1;

		uint _totalSupply = totalSupply();
		if (_totalSupply == 0) {
			liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
			_mint(address(0), MINIMUM_LIQUIDITY); // lock minimal liquidity
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

	/// @notice Burn LP tokens and return underlying assets to `to`
	/// @dev Caller must be router; uses `lock` guard
	/// @return amount0 Token0 withdrawn
	/// @return amount1 Token1 withdrawn
	function burn(
		address to
	) external lock onlyOwner returns (uint amount0, uint amount1) {
		PairStorage storage $ = _getPairStorage();
		(uint112 _reserve0, uint112 _reserve1) = ($.reserve0, $.reserve1);

		address _token0 = $.token0;
		address _token1 = $.token1;
		uint balance0 = IERC20(_token0).balanceOf(address(this));
		uint balance1 = IERC20(_token1).balanceOf(address(this));
		uint liquidity = balanceOf(address(this));

		uint _totalSupply = totalSupply();
		amount0 = (liquidity * balance0) / _totalSupply;
		amount1 = (liquidity * balance1) / _totalSupply;
		require(
			amount0 > 0 && amount1 > 0,
			"Pair: INSUFFICIENT_LIQUIDITY_BURNED"
		);

		_burn(address(this), liquidity);
		_safeTransfer(_token0, to, amount0);
		_safeTransfer(_token1, to, amount1);

		balance0 = IERC20(_token0).balanceOf(address(this));
		balance1 = IERC20(_token1).balanceOf(address(this));
		_update(balance0, balance1, _reserve0, _reserve1);

		emit Burn(msg.sender, amount0, amount1, to);
	}

	// ──────────────────────────────────────────────
	// 🔄 Swaps
	// ──────────────────────────────────────────────

	/// @notice Swap token amounts to `to`
	/// @param amount0Out Desired amount of token0 to send out
	/// @param amount1Out Desired amount of token1 to send out
	/// @param to Recipient address
	function swap(
		uint amount0Out,
		uint amount1Out,
		address to
	) external lock onlyOwner {
		require(
			amount0Out > 0 || amount1Out > 0,
			"Pair: INSUFFICIENT_OUTPUT_AMOUNT"
		);

		PairStorage storage store = _getPairStorage();
		(uint112 reserve0, uint112 reserve1, ) = getReserves();
		require(
			amount0Out < reserve0 && amount1Out < reserve1,
			"Pair: INSUFFICIENT_LIQUIDITY"
		);
		require(to != store.token0 && to != store.token1, "Pair: INVALID_TO");

		// net amounts after fee and feePercent
		(uint net0, uint feePercent0) = _getEffectiveAmountOut(
			amount0Out,
			reserve0
		);
		(uint net1, uint feePercent1) = _getEffectiveAmountOut(
			amount1Out,
			reserve1
		);

		if (net0 > 0) _safeTransfer(store.token0, to, net0);
		if (net1 > 0) _safeTransfer(store.token1, to, net1);

		uint balance0 = IERC20(store.token0).balanceOf(address(this));
		uint balance1 = IERC20(store.token1).balanceOf(address(this));

		uint amount0In = balance0 > reserve0 - net0
			? balance0 - (reserve0 - net0)
			: 0;
		uint amount1In = balance1 > reserve1 - net1
			? balance1 - (reserve1 - net1)
			: 0;
		require(
			amount0In > 0 || amount1In > 0,
			"Pair: INSUFFICIENT_INPUT_AMOUNT"
		);

		// enforce constant product invariant
		uint bal0Adj = balance0 * FEE_BASIS_POINTS - (amount0In * feePercent0);
		uint bal1Adj = balance1 * FEE_BASIS_POINTS - (amount1In * feePercent1);
		require(
			bal0Adj * bal1Adj >=
				uint(reserve0) * uint(reserve1) * (FEE_BASIS_POINTS ** 2),
			"Pair: K"
		);

		bool feeOn = _mintSwapFee(
			reserve0,
			reserve1,
			feePercent0 + feePercent1
		);
		_update(balance0, balance1, reserve0, reserve1);
		if (feeOn) {
			PairStorage storage $ = _getPairStorage();
			$.kLast = uint($.reserve0) * $.reserve1;
		}

		emit Swap(msg.sender, amount0In, amount1In, net0, net1, to);
	}

	/// @dev Mint protocol fee LP tokens if fee is on
	function _mintSwapFee(
		uint112 _reserve0,
		uint112 _reserve1,
		uint combinedFeePercent
	) private returns (bool feeOn) {
		PairStorage storage $ = _getPairStorage();
		address feeTo = ISwapFactory($.router).feeTo();
		feeOn = feeTo != address(0);
		uint _kLast = $.kLast;

		if (feeOn && combinedFeePercent > 0) {
			uint rootK = Math.sqrt(uint(_reserve0) * _reserve1);
			uint rootKLast = Math.sqrt(_kLast);
			if (rootK > rootKLast) {
				uint numerator = totalSupply() * (rootK - rootKLast);
				uint denominator = (rootK * combinedFeePercent) + rootKLast;
				uint liquidity = numerator / denominator;
				if (liquidity > 0) _mint(feeTo, liquidity);
			}
		} else if (_kLast != 0) {
			$.kLast = 0;
		}
	}

	// ──────────────────────────────────────────────
	// 🔍 Public Views & Helpers
	// ──────────────────────────────────────────────

	/// @notice Returns router address
	function router() external view returns (address) {
		return _getPairStorage().router;
	}

	/// @notice Returns token0 address
	function token0() external view returns (address) {
		return _getPairStorage().token0;
	}

	/// @notice Returns token1 address
	function token1() external view returns (address) {
		return _getPairStorage().token1;
	}

	/// @notice Returns reserves and last block timestamp
	function getReserves() public view returns (uint112, uint112, uint32) {
		PairStorage storage $ = _getPairStorage();
		return ($.reserve0, $.reserve1, $.blockTimestampLast);
	}

	/// @notice Last cumulative price of token0
	function price0CumulativeLast() external view returns (uint256) {
		return _getPairStorage().price0CumulativeLast;
	}

	/// @notice Last cumulative price of token1
	function price1CumulativeLast() external view returns (uint256) {
		return _getPairStorage().price1CumulativeLast;
	}

	/// @notice Calculate fee percent in basis points for an amount given the reserve
	function calculateFeePercent(
		uint256 amount,
		uint256 reserve
	) public view returns (uint256) {
		(uint256 r0, uint256 r1, ) = getReserves();
		require(reserve == r0 || reserve == r1, "Pair: INVALID_RESERVE");
		(uint256 minF, uint256 maxF) = feePercents();

		uint256 reserveGap = 0;
		if (reserve == r0 && r0 > r1) reserveGap = r0 - r1;
		else if (reserve == r1 && r1 > r0) reserveGap = r1 - r0;

		uint256 totalLiq = totalSupply();
		uint256 liq = ((amount + reserveGap) * totalLiq) / reserve;
		uint256 fee = minF + (liq * (maxF - minF)) / totalLiq;
		return fee > maxF ? maxF : fee;
	}

	/// @notice Returns current fee bounds (minFee, maxFee)
	function feePercents() public view returns (uint256, uint256) {
		PairStorage storage $ = _getPairStorage();
		return ($.minFee, $.maxFee);
	}
}
