// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { UpgradeableBeacon } from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

import { SwapFactory } from "./abstracts/SwapFactory.sol";
import { UserModule } from "./abstracts/UserModule.sol";

import { IRouter } from "./interfaces/IRouter.sol";
import { IPair } from "./interfaces/IPair.sol";

import { TokenPayment, TokenPayments } from "./libraries/TokenPayments.sol";
import { OracleLibrary } from "./libraries/OracleLibrary.sol";
import { DeployGovernance } from "./libraries/DeployGovernance.sol";
import { DeployPriceOracle } from "./libraries/DeployPriceOracle.sol";
import { DeployWNTV } from "./libraries/DeployWNTV.sol";
import { AMMLibrary } from "./libraries/AMMLibrary.sol";
import { TransferHelper } from "./libraries/TransferHelper.sol";
import { Epochs } from "./libraries/Epochs.sol";

import { WNTV } from "./tokens/WNTV.sol";

import { Governance } from "./Governance.sol";
import { PriceOracle } from "./PriceOracle.sol";
import { Pair, IERC20 } from "./Pair.sol";

import "./types.sol";
import "./errors.sol";

library RouterLib {
	using TokenPayments for TokenPayment;
	using TokenPayments for address;

	// requires the initial amount to have already been sent to the first pair
	function _swap(
		uint[2][] memory amounts,
		address[] memory path,
		address _to,
		address pairsBeacon
	) internal {
		for (uint i; i < path.length - 1; i++) {
			(address input, address output) = (path[i], path[i + 1]);
			uint amount0Out;
			uint feeAmount0;
			uint amount1Out;
			uint feeAmount1;

			{
				(address token0, ) = AMMLibrary.sortTokens(input, output);
				uint amountOut = amounts[i + 1][0];
				uint feeAmount = amounts[i + 1][1];
				(amount0Out, feeAmount0, amount1Out, feeAmount1) = input ==
					token0
					? (uint(0), uint(0), amountOut, feeAmount)
					: (amountOut, feeAmount, uint(0), uint(0));
			}

			address to = i < path.length - 2
				? AMMLibrary.pairFor(
					address(this),
					pairsBeacon,
					output,
					path[i + 2]
				)
				: _to;
			IPair(AMMLibrary.pairFor(address(this), pairsBeacon, input, output))
				.swap(amount0Out, feeAmount0, amount1Out, feeAmount1, to);
		}
	}

	function _addLiquidity(
		address tokenA,
		address tokenB,
		uint amountADesired,
		uint amountBDesired,
		uint amountAMin,
		uint amountBMin,
		address pair
	) internal view returns (uint amountA, uint amountB) {
		if (pair == address(0)) {
			revert Router.PairNotListed(tokenA, tokenB);
		}

		(uint reserveA, uint reserveB, ) = IPair(pair).getReserves();
		if (reserveA == 0 && reserveB == 0) {
			(amountA, amountB) = (amountADesired, amountBDesired);
		} else {
			uint amountBOptimal = AMMLibrary.quote(
				amountADesired,
				reserveA,
				reserveB
			);
			if (amountBOptimal <= amountBDesired) {
				if (amountBOptimal < amountBMin)
					revert Router.InSufficientBAmount();
				(amountA, amountB) = (amountADesired, amountBOptimal);
			} else {
				uint amountAOptimal = AMMLibrary.quote(
					amountBDesired,
					reserveB,
					reserveA
				);
				assert(amountAOptimal <= amountADesired);
				if (amountAOptimal < amountAMin)
					revert Router.InSufficientAAmount();
				(amountA, amountB) = (amountAOptimal, amountBDesired);
			}
		}
	}

	function _mintLiquidity(
		TokenPayment memory paymentA,
		TokenPayment memory paymentB,
		address pair,
		address wNativeToken
	) internal returns (uint liquidity) {
		// Prepare payment{A,B} for reception
		if (paymentA.token == wNativeToken && msg.value == paymentA.amount) {
			paymentA.token = address(0);
		} else if (
			paymentB.token == wNativeToken && msg.value == paymentB.amount
		) {
			paymentB.token = address(0);
		}

		paymentA.receiveTokenFor(msg.sender, pair, wNativeToken);
		paymentB.receiveTokenFor(msg.sender, pair, wNativeToken);

		liquidity = IPair(pair).mint(msg.sender);
	}

	function addLiquidity(
		TokenPayment memory paymentA,
		TokenPayment memory paymentB,
		uint amountAMin,
		uint amountBMin,
		address pair,
		address wNativeToken
	) external returns (uint amountA, uint amountB, uint liquidity) {
		(amountA, amountB) = _addLiquidity(
			paymentA.token,
			paymentB.token,
			paymentA.amount,
			paymentB.amount,
			amountAMin,
			amountBMin,
			pair
		);

		liquidity = _mintLiquidity(paymentA, paymentB, pair, wNativeToken);
	}

	function swapExactTokensForTokens(
		uint amountIn,
		uint amountOutMin,
		address[] calldata path,
		address to,
		address _originalCaller,
		address wNtvAddr,
		address governance,
		address pairsBeacon
	) external returns (uint[2][] memory amounts) {
		amounts = AMMLibrary.getAmountsOut(
			address(this),
			pairsBeacon,
			amountIn,
			path
		);
		require(
			amounts[amounts.length - 1][0] >= amountOutMin,
			"Router: INSUFFICIENT_OUTPUT_AMOUNT"
		);

		{
			// Send token scope
			address pair = AMMLibrary.pairFor(
				address(this),
				pairsBeacon,
				path[0],
				path[1]
			);
			if (msg.value > 0) {
				require(
					msg.value == amountIn,
					"Router: INVALID_AMOUNT_IN_VALUES"
				);
				require(path[0] == wNtvAddr, "Router: INVALID_PATH");
				WNTV(payable(wNtvAddr)).receiveFor{ value: msg.value }(pair);
			} else {
				TransferHelper.safeTransferFrom(
					path[0],
					_originalCaller == address(0)
						? msg.sender
						: _originalCaller,
					pair,
					amounts[0][0]
				);
			}
		}

		// Swap and prepare to unWrap Native if needed
		bool autoUnwrap = to != governance && path[path.length - 1] == wNtvAddr;
		_swap(amounts, path, autoUnwrap ? address(this) : to, pairsBeacon);
		if (autoUnwrap)
			path[path.length - 1].sendFungibleToken(
				amounts[path.length - 1][0],
				to
			);
	}
}

contract Router is
	IRouter,
	SwapFactory,
	OwnableUpgradeable,
	UserModule,
	Errors
{
	using TokenPayments for TokenPayment;
	using Epochs for Epochs.Storage;

	/// @custom:storage-location erc7201:gainz.Router.storage
	struct RouterStorage {
		address feeTo;
		address feeToSetter;
		//
		address wNativeToken;
		address proxyAdmin;
		address pairsBeacon;
		address governance;
		Epochs.Storage epochs;
	}

	// keccak256(abi.encode(uint256(keccak256("gainz.Router.storage")) - 1)) & ~bytes32(uint256(0xff));
	bytes32 private constant ROUTER_STORAGE_LOCATION =
		0xae974aecfb7025a5d7fc4d7e9ba067575060084b22f04fa48d6bbae6c0d48d00;

	function _getRouterStorage()
		private
		pure
		returns (RouterStorage storage $)
	{
		assembly {
			$.slot := ROUTER_STORAGE_LOCATION
		}
	}

	// **** INITIALIZATION ****

	function initialize(
		address initialOwner,
		address gainzToken
	) public initializer {
		__Ownable_init(initialOwner);

		RouterStorage storage $ = _getRouterStorage();

		$.feeToSetter = $.feeTo = owner();
		$.proxyAdmin = msg.sender;
		$.epochs.initialize(24 hours);

		// Deploy the UpgradeableBeacon contract
		$.pairsBeacon = address(
			new UpgradeableBeacon(address(new Pair()), $.proxyAdmin)
		);

		// set Wrapped Native Token;
		$.wNativeToken = DeployWNTV.create($.proxyAdmin);
		$.governance = DeployGovernance.create(
			$.epochs,
			gainzToken,
			$.wNativeToken,
			$.proxyAdmin
		);
	}

	function setPriceOracle() public {
		assert(
			OracleLibrary.oracleAddress(address(this)) ==
				DeployPriceOracle.create()
		);
	}

	// **** END INITIALIZATION ****

	function createPair(
		TokenPayment memory paymentA,
		TokenPayment memory paymentB
	)
		external
		payable
		override
		returns (address pairAddress, uint256 liquidity)
	{
		address govAddr = _getRouterStorage().governance;
		require(msg.sender == govAddr, "Not open for all");

		Governance governance = Governance(payable(govAddr));
		bool isTokenAInFunding = governance.pairListing(paymentA.token).owner !=
			address(0);
		bool isTokenBInFunding = governance.pairListing(paymentA.token).owner !=
			address(0);
		require(
			!isTokenAInFunding && !isTokenBInFunding,
			"Token already in LaunchPair"
		);

		pairAddress = _createPair(
			paymentA.token,
			paymentB.token,
			_getRouterStorage().pairsBeacon
		);
		(, , liquidity, ) = addLiquidity(
			paymentA,
			paymentB,
			0,
			0,
			block.timestamp + 1
		);

		PriceOracle(OracleLibrary.oracleAddress(address(this))).add(
			paymentA.token == address(0)
				? getWrappedNativeToken()
				: paymentA.token,
			paymentB.token == address(0)
				? getWrappedNativeToken()
				: paymentB.token
		);
	}

	// **** SWAP ****

	error Expired();

	modifier ensure(uint deadline) {
		if (deadline < block.timestamp) revert Expired();
		_;
	}

	address _originalCaller;
	modifier captureOriginalCaller() {
		assert(_originalCaller == address(0));
		_originalCaller = msg.sender;
		_;
		_originalCaller = address(0);
	}

	function registerAndSwap(
		uint256 referrerId,
		bytes calldata swapData
	) external payable captureOriginalCaller {
		// Step 1: Register user or get existing user ID
		_createOrGetUserId(msg.sender, referrerId);

		// Step 2: Execute swap based on swapData with assembly to capture errors
		(bool success, bytes memory returnData) = address(this).call{
			value: msg.value
		}(swapData);

		// Inline assembly to handle errors
		assembly {
			// If the call failed, check if there is return data (error message)
			if iszero(success) {
				if gt(mload(returnData), 0) {
					// Revert with the actual error message from the failed call
					revert(add(returnData, 32), mload(returnData))
				}
				// If there is no return data, revert with a generic message
				revert(0, 0)
			}
		}
	}

	function register(address user, uint256 referrerId) external {
		assert(
			msg.sender ==
				address(
					Governance(payable(_getRouterStorage().governance))
						.launchPair()
				)
		);
		_createOrGetUserId(user, referrerId);
	}

	function swapExactTokensForTokens(
		uint amountIn,
		uint amountOutMin,
		address[] calldata path,
		address to,
		uint deadline
	)
		external
		payable
		virtual
		ensure(deadline)
		returns (uint[2][] memory amounts)
	{
		return
			RouterLib.swapExactTokensForTokens(
				amountIn,
				amountOutMin,
				path,
				to,
				_originalCaller,
				getWrappedNativeToken(),
				_getRouterStorage().governance,
				getPairsBeacon()
			);
	}

	// **** ADD LIQUIDITY ****

	error PairNotListed(address tokenA, address tokenB);
	error InSufficientAAmount();
	error InSufficientBAmount();

	function addLiquidity(
		TokenPayment memory paymentA,
		TokenPayment memory paymentB,
		uint amountAMin,
		uint amountBMin,
		uint deadline
	)
		public
		payable
		virtual
		ensure(deadline)
		returns (uint amountA, uint amountB, uint liquidity, address pair)
	{
		pair = getPair(paymentA.token, paymentB.token);

		(amountA, amountB, liquidity) = RouterLib.addLiquidity(
			paymentA,
			paymentB,
			amountAMin,
			amountBMin,
			pair,
			getWrappedNativeToken()
		);
	}

	function removeLiquidity(
		address tokenA,
		address tokenB,
		uint liquidity,
		uint amountAMin,
		uint amountBMin,
		address to,
		uint deadline
	) external ensure(deadline) returns (uint amountA, uint amountB) {
		address pair = getPair(tokenA, tokenB);
		require(pair != address(0), "Router: INVALID_PAIR");

		// Transfer liquidity tokens from the sender to the pair
		Pair(pair).transferFrom(msg.sender, pair, liquidity);

		// Burn liquidity tokens to receive tokenA and tokenB
		(uint amount0, uint amount1) = IPair(pair).burn(to);
		(address token0, ) = AMMLibrary.sortTokens(tokenA, tokenB);
		(amountA, amountB) = tokenA == token0
			? (amount0, amount1)
			: (amount1, amount0);

		// Ensure minimum amounts are met
		if (amountA < amountAMin) revert InSufficientAAmount();
		if (amountB < amountBMin) revert InSufficientBAmount();
	}

	// ******* VIEWS *******

	function getWrappedNativeToken() public view returns (address) {
		return _getRouterStorage().wNativeToken;
	}

	function getPairsBeacon() public view returns (address) {
		return _getRouterStorage().pairsBeacon;
	}

	function getGovernance() external view returns (address) {
		return _getRouterStorage().governance;
	}

	function feeTo() external view returns (address) {
		return _getRouterStorage().feeTo;
	}

	function feeToSetter() public view returns (address) {
		return _getRouterStorage().feeToSetter;
	}

	function setFeeTo(address _feeTo) external {
		require(msg.sender == feeToSetter(), "Router: FORBIDDEN");
		_getRouterStorage().feeTo = _feeTo;
	}

	function setFeeToSetter(address _feeToSetter) external {
		require(msg.sender == feeToSetter(), "Router: FORBIDDEN");
		_getRouterStorage().feeToSetter = _feeToSetter;
	}

	receive() external payable {}
}
