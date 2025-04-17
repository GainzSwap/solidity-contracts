// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { ERC1155HolderUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { TokenPayment, TokenPayments } from "./libraries/TokenPayments.sol";
import { OracleLibrary } from "./libraries/OracleLibrary.sol";
import { FixedPoint128 } from "./libraries/FixedPoint128.sol";
import { FullMath } from "./libraries/FullMath.sol";
import { Number } from "./libraries/Number.sol";
import { Epochs } from "./libraries/Epochs.sol";
import "./libraries/utils.sol";
import { DeployGToken } from "./libraries/DeployGToken.sol";
import { DeployLaunchPair } from "./libraries/DeployLaunchPair.sol";

import { GToken, GTokenLib, GTokenBalance } from "./tokens/GToken/GToken.sol";
import { WNTV } from "./tokens/WNTV.sol";
import { Gainz } from "./tokens/Gainz/Gainz.sol";

import { Pair } from "./Pair.sol";
import { Router } from "./Router.sol";
import { PriceOracle } from "./PriceOracle.sol";
import { LaunchPair } from "./LaunchPair.sol";

import "./types.sol";
import "./errors.sol";

library GovernanceLib {
	using Epochs for Epochs.Storage;
	using GTokenLib for GTokenLib.Attributes;
	using TokenPayments for TokenPayment;
	using TokenPayments for address;
	using Number for uint256;
	using EnumerableSet for EnumerableSet.AddressSet;

	function _calculateClaimableReward(
		address user,
		uint256[] memory nonces,
		address gtoken,
		uint256 rewardPerShare
	)
		internal
		view
		returns (
			uint256 claimableReward,
			GTokenLib.Attributes[] memory attributes
		)
	{
		attributes = new GTokenLib.Attributes[](nonces.length);

		for (uint256 i = 0; i < nonces.length; i++) {
			attributes[i] = GToken(gtoken)
				.getBalanceAt(user, nonces[i])
				.attributes;

			// Added to fix distribution of gainzILODeposit to rewards
			uint256 tokenRPS = attributes[i].rewardPerShare;
			uint256 rpsDiff = rewardPerShare >= tokenRPS
				? rewardPerShare - tokenRPS
				: rewardPerShare;

			claimableReward += FullMath.mulDiv(
				attributes[i].stakeWeight,
				rpsDiff,
				FixedPoint128.Q128
			);
		}
	}

	function _claimRewards(
		Governance.GovernanceStorage storage $,
		address user,
		uint256[] memory nonces
	)
		internal
		returns (
			uint256 claimableReward,
			GTokenLib.Attributes[] memory attributes
		)
	{
		// Calculate rewards to be claimed on unstaking
		(claimableReward, attributes) = _calculateClaimableReward(
			user,
			nonces,
			$.gtoken,
			$.rewardPerShare
		);

		// Transfer the claimable rewards to the user, if any
		if (claimableReward > 0) {
			$.rewardsReserve -= claimableReward;
			IERC20($.gainzToken).transfer(user, claimableReward);
		}
	}

	function unStake(
		Governance.GovernanceStorage storage $,
		uint256 nonce,
		uint amount0Min,
		uint amount1Min
	) external {
		Gainz($.gainzToken).mintGainz();

		address user = msg.sender;
		uint256[] memory nonces = new uint256[](1);
		nonces[0] = nonce;
		(, GTokenLib.Attributes[] memory attributes) = _claimRewards(
			$,
			user,
			nonces
		);
		GTokenLib.Attributes memory attribute = attributes[0];

		GToken($.gtoken).burn(user, nonce, attribute.supply());

		uint256 liquidity = attribute.lpDetails.liquidity;
		uint256 liquidityToReturn = attribute.epochsLocked == 0
			? liquidity
			: attribute.valueToKeep(liquidity, $.epochs.currentEpoch());
		if (liquidityToReturn < liquidity) {
			$.pairLiqFee[attribute.lpDetails.pair] +=
				liquidity -
				liquidityToReturn;

			// Adjust slippage accordingly
			amount0Min = (amount0Min * liquidityToReturn) / liquidity;
			amount1Min = (amount1Min * liquidityToReturn) / liquidity;
		}

		address token0 = attribute.lpDetails.token0;
		address token1 = attribute.lpDetails.token1;

		Pair(
			PriceOracle(OracleLibrary.oracleAddress($.router)).pairFor(
				token0,
				token1
			)
		).approve($.router, liquidityToReturn);
		Router(payable($.router)).removeLiquidity(
			token0,
			token1,
			liquidityToReturn,
			amount0Min,
			amount1Min,
			user,
			block.timestamp + 1
		);
	}
}

/// @title Governance Contract
/// @notice This contract handles the governance process by allowing users to lock GToken tokens and mint GTokens.
/// @dev This contract interacts with the GTokens library and manages GToken token payments.
contract Governance is ERC1155HolderUpgradeable, OwnableUpgradeable, Errors {
	using Epochs for Epochs.Storage;
	using GTokenLib for GTokenLib.Attributes;
	using TokenPayments for TokenPayment;
	using TokenPayments for address;
	using EnumerableSet for EnumerableSet.AddressSet;
	using EnumerableSet for EnumerableSet.UintSet;

	struct TokenListing {
		uint256 yesVote; // Number of yes votes
		uint256 noVote; // Number of no votes
		uint256 totalGTokenAmount; // Total GToken amount locked for the listing
		uint256 endEpoch; // Epoch when the listing proposal ends
		address owner; // The owner proposing the listing
		TokenPayment securityGTokenPayment;
		TokenPayment tradeTokenPayment; // The token proposed for trading
		uint256 campaignId; // launchPair campaign ID
	}

	/// @custom:storage-location erc7201:gainz.Governance.storage
	struct GovernanceStorage {
		uint256 rewardPerShare;
		uint256 rewardsReserve;
		// The following values should be immutable
		address gtoken;
		address gainzToken;
		address router;
		address wNativeToken;
		Epochs.Storage epochs;
		// New vars after adding launchpair
		uint256 protocolFees;
		address protocolFeesCollector;
		mapping(address => EnumerableSet.UintSet) userVotes;
		mapping(address => address) userVote;
		TokenListing activeListing;
		EnumerableSet.AddressSet pendingOrListedTokens;
		mapping(address => TokenListing) pairOwnerListing;
		LaunchPair launchPair;
		mapping(address => uint) pairLiqFee;
	}

	// keccak256(abi.encode(uint256(keccak256("gainz.Governance.storage")) - 1)) & ~bytes32(uint256(0xff));
	bytes32 private constant GOVERNANCE_STORAGE_LOCATION =
		0x8a4dda5430cdcd8aca8f2a075bbbae5f31557dc6b6b93555c9c43f674de00c00;

	function _getGovernanceStorage()
		private
		pure
		returns (GovernanceStorage storage $)
	{
		assembly {
			$.slot := GOVERNANCE_STORAGE_LOCATION
		}
	}

	/// @notice Function to initialize the Governance contract.
	/// @param _epochs The epochs storage instance for managing epochs.
	function initialize(
		Epochs.Storage memory _epochs,
		address gainzToken,
		address wNativeToken,
		address proxyAdmin
	) public initializer {
		address router = msg.sender;
		__Ownable_init(router);

		GovernanceStorage storage $ = _getGovernanceStorage();

		$.epochs = _epochs;
		$.gtoken = DeployGToken.create($.epochs, address(this), proxyAdmin);

		$.router = router;
		$.wNativeToken = wNativeToken;
		require(
			$.wNativeToken != address(0),
			"Governance: INVALID_WRAPPED_NATIVE_TOKEN"
		);

		require(gainzToken != address(0), "Invalid gainzToken");
		$.gainzToken = gainzToken;

		$.launchPair = DeployLaunchPair.newLaunchPair($.gtoken, proxyAdmin);
	}

	function _getDesiredToken(
		address[] calldata path,
		TokenPayment calldata stakingPayment,
		uint256[2] calldata amounts, // [0]: amountIn, [1]: amountOutMin
		uint256 deadline
	) internal returns (TokenPayment memory payment) {
		uint256 amountIn = amounts[0];
		uint256 amountOutMin = amounts[1];

		if (path.length < 2) {
			payment = stakingPayment;
			payment.amount = amountIn;

			return payment;
		}

		if (payment.token == stakingPayment.token) revert InvalidPath(path);

		payment.token = path[path.length - 1];
		payment.amount = Router(payable(_getGovernanceStorage().router))
			.swapExactTokensForTokens(
				amountIn,
				amountOutMin,
				path,
				address(this),
				deadline
			)[path.length - 1][0];
	}

	function _computeLiqValue(
		address router,
		address wNativeToken,
		TokenPayment memory paymentA,
		TokenPayment memory paymentB,
		address[] calldata pathToNative
	) internal returns (uint256 value) {
		// Validate the pathToNative
		if (
			pathToNative.length < 2 || // `pathToNative` must have valid length
			pathToNative[pathToNative.length - 1] != wNativeToken || // The last token must be the native token (i.e., the reference token)
			(pathToNative[0] != paymentA.token &&
				pathToNative[0] != paymentB.token) // The first token must be one of the payment tokens
		) revert InvalidPath(pathToNative);

		// Get the PriceOracle instance
		PriceOracle priceOracle = PriceOracle(
			OracleLibrary.oracleAddress(router)
		);

		// Start with the payment amount
		value = (pathToNative[0] == paymentA.token ? paymentA : paymentB)
			.amount;

		// Convert the payment amount to the native token using the provided path
		for (uint256 i = 0; i < pathToNative.length - 1; i++) {
			value = priceOracle.updateAndConsult(
				pathToNative[i],
				pathToNative[i + 1],
				value
			);
		}

		value *= 2;

		// Ensure the computed value is valid
		require(value > 0, "Governance: INVALID_COMPUTED_LIQ_VALUE");
	}

	function _receiveAndApprovePayment(
		TokenPayment memory payment,
		address router,
		address wNativeToken
	) internal {
		bool paymentIsNative = msg.value > 0 && payment.token == wNativeToken;

		if (paymentIsNative) payment.token = address(0);
		payment.receiveTokenFor(msg.sender, address(this), wNativeToken);
		if (paymentIsNative) payment.token = wNativeToken;

		// Optimistically approve `router` to spend payment in `_getDesiredToken` call
		payment.approve(router);
	}

	/**
	 * @notice Stakes liquidity by providing two token payments and receiving governance tokens (GToken).
	 * @dev Handles native token wrapping if one of the tokens is the wrapped native token (wNativeToken).
	 * @param paymentA Token payment details for token A.
	 * @param paymentB Token payment details for token B.
	 * @param epochsLocked Number of epochs the liquidity is locked for.
	 * @param numbers Array containing [0]: amountAMin, [1]: amountBMin, [2]: deadline.
	 * @param pathToNative Swap path to native token for calculations.
	 * @return uint256 Nonce of GToken minted.
	 */
	function stakeLiquidity(
		TokenPayment calldata paymentA,
		TokenPayment calldata paymentB,
		uint256 epochsLocked,
		uint[3] calldata numbers, // [0]: amountAMin, [1]: amountBMin, [2]: deadline
		address[] calldata pathToNative
	) external payable returns (uint256) {
		GovernanceStorage storage $ = _getGovernanceStorage();

		// Handle native token deposit if required
		if (msg.value > 0) {
			require(
				msg.value ==
					(
						$.wNativeToken == paymentA.token
							? paymentA.amount
							: paymentB.amount
					),
				"Governance: INVALID_AMOUNT_IN_VALUES"
			);
		}

		_receiveAndApprovePayment(paymentA, $.router, $.wNativeToken);
		_receiveAndApprovePayment(paymentB, $.router, $.wNativeToken);

		// Construct liquidity info arguments separately to avoid stack too deep error
		LiqInfoOtherArgs memory liqInfoArgs = LiqInfoOtherArgs({
			amountAMin: numbers[0],
			amountBMin: numbers[1],
			deadline: numbers[2],
			wNativeToken: $.wNativeToken
		});

		return
			_mintGToken(
				msg.sender,
				$.gtoken,
				$.rewardPerShare,
				epochsLocked,
				_getLiqInfo(
					$.router,
					paymentA,
					paymentB,
					pathToNative,
					liqInfoArgs
				)
			);
	}

	/**
	 * @notice Allows users to stake tokens for a specified duration into a particular pool.
	 * @dev Handles token payments, token swapping, and staking with predefined paths.
	 * @param payment The token payment details including amount and token address.
	 * @param epochsLocked The number of epochs the tokens will be locked for.
	 * @param paths The swap paths used for staking:
	 *        - paths[0]: Path A (payment token to tokenA)
	 *        - paths[1]: Path B (payment token to tokenB)
	 *        - paths[2]: Path to Native token for liquidity value.
	 * @param path_AB_amounts Swap amounts and slippage limits:
	 *        - path_AB_amounts[0]: For Path A:
	 *          - [0]: amountIn (tokenA amount)
	 *          - [1]: amountOutMin (minimum expected output)
	 *        - path_AB_amounts[1]: For Path B:
	 *          - [0]: amountIn (tokenB amount)
	 *          - [1]: amountOutMin (minimum expected output)
	 * @param deadline The transaction deadline to prevent execution if expired.
	 * @return The GToken nonce.
	 */
	function stake(
		TokenPayment calldata payment,
		uint256 epochsLocked,
		address[][3] calldata paths,
		uint256[2][2] calldata path_AB_amounts,
		uint256 deadline
	) external payable returns (uint256) {
		// Validate the payment amount
		if (
			payment.amount == 0 ||
			(msg.value > 0 && payment.amount != msg.value)
		) revert InvalidPayment(payment, msg.value);

		// Retrieve the governance storage
		GovernanceStorage storage $ = _getGovernanceStorage();

		// Initialize liquidity info
		LiquidityInfo memory liqInfo;
		{
			// Receive and approve the payment
			_receiveAndApprovePayment(payment, $.router, $.wNativeToken);

			// Swap the payment tokens into the desired tokens
			TokenPayment memory paymentA = _getDesiredToken(
				paths[0],
				payment,
				path_AB_amounts[0],
				deadline
			);
			TokenPayment memory paymentB = _getDesiredToken(
				paths[1],
				payment,
				path_AB_amounts[1],
				deadline
			);
			require(
				paymentA.token != paymentB.token,
				"Governance: INVALID_PATH_VALUES"
			);

			// Approve the router to spend the swapped tokens
			paymentA.approve($.router);
			paymentB.approve($.router);

			liqInfo = _getLiqInfo(
				$.router,
				paymentA,
				paymentB,
				paths[2],
				LiqInfoOtherArgs(
					path_AB_amounts[0][1], // amountAMin
					path_AB_amounts[1][1], // amountBMin
					deadline,
					$.wNativeToken
				)
			);
		}

		// Mint GToken tokens for the user
		return
			_mintGToken(
				msg.sender,
				$.gtoken,
				$.rewardPerShare,
				epochsLocked,
				liqInfo
			);
	}

	struct LiqInfoOtherArgs {
		uint amountAMin;
		uint amountBMin;
		uint deadline;
		address wNativeToken;
	}

	function _getLiqInfo(
		address router,
		TokenPayment memory paymentA,
		TokenPayment memory paymentB,
		address[] calldata pathToNative,
		LiqInfoOtherArgs memory args
	) internal returns (LiquidityInfo memory liqInfo) {
		// Add liquidity using the router
		(, , liqInfo.liquidity, liqInfo.pair) = Router(payable(router))
			.addLiquidity(
				paymentA,
				paymentB,
				args.amountAMin,
				args.amountBMin,
				args.deadline
			);

		// Compute the liquidity value
		liqInfo.liqValue = _computeLiqValue(
			router,
			args.wNativeToken,
			paymentA,
			paymentB,
			pathToNative
		);

		(liqInfo.token0, liqInfo.token1) = paymentA.token < paymentB.token
			? (paymentA.token, paymentB.token)
			: (paymentB.token, paymentA.token);
	}

	function _mintGToken(
		address to,
		address gToken,
		uint256 rewardPerShare_,
		uint256 epochsLocked,
		LiquidityInfo memory liqInfo
	) internal returns (uint256) {
		return
			GToken(gToken).mintGToken(
				to,
				rewardPerShare_,
				epochsLocked,
				liqInfo
			);
	}

	/**
	 * @dev Calculates the emission-adjusted reward reserve and reward-per-share.
	 *      This function is typically called when new rewards are being distributed to stakers.
	 * @param amount The raw reward amount to be distributed (e.g. native token like ETH/BNB).
	 * @param totalStakeWeight The total weight across all active stakers (based on stake + boost, etc).
	 * @return _rewardsReserve The scaled reward based on bonding curve logic using `WNTV.scaleEmission`.
	 * @return _rewardPerShare The reward per unit weight (Q128 fixed-point format).
	 */
	function _addGainzMint(
		uint amount,
		uint256 totalStakeWeight
	) private view returns (uint _rewardsReserve, uint _rewardPerShare) {
		if (totalStakeWeight > 0) {
			// Apply emission scaling based on current dEDU supply relative to its target
			_rewardsReserve = WNTV(
				payable(_getGovernanceStorage().wNativeToken)
			).scaleEmission(amount);

			// Calculate how much reward each share receives in Q128 fixed point
			_rewardPerShare = FullMath.mulDiv(
				_rewardsReserve,
				FixedPoint128.Q128,
				totalStakeWeight
			);
		}
	}

	/// @notice Updates the rewards reserve by adding the specified amount.
	function updateRewardReserve() external {
		GovernanceStorage storage $ = _getGovernanceStorage();

		uint256 amount = IERC20($.gainzToken).balanceOf(address(this)) -
			$.rewardsReserve;
		uint _rewardPerShare;

		uint256 totalStakeWeight = GToken($.gtoken).totalStakeWeight();
		(amount, _rewardPerShare) = _addGainzMint(amount, totalStakeWeight);
		// Update the rewards reserve
		$.rewardsReserve += amount;
		$.rewardPerShare += _rewardPerShare;
	}

	function createPair(
		TokenPayment calldata tradeTokenPayment,
		TokenPayment calldata pairedTokenPayment,
		address[] calldata pathToNative,
		uint256 epochsLocked
	) external returns (uint256) {
		GovernanceStorage storage $ = _getGovernanceStorage();
		require(msg.sender == address($.launchPair), "Governance: FORBIDDEN");

		_receiveAndApprovePayment(tradeTokenPayment, $.router, $.wNativeToken);
		_receiveAndApprovePayment(pairedTokenPayment, $.router, $.wNativeToken);

		(address pair, uint256 liquidity) = Router(payable($.router))
			.createPair(tradeTokenPayment, pairedTokenPayment);

		uint256 liqValue = pathToNative[pathToNative.length - 1] ==
			pairedTokenPayment.token &&
			pathToNative.length == 1
			? pairedTokenPayment.amount
			: _computeLiqValue(
				$.router,
				$.wNativeToken,
				tradeTokenPayment,
				pairedTokenPayment,
				pathToNative
			);
		LiquidityInfo memory liqInfo = LiquidityInfo({
			pair: pair,
			liquidity: liquidity,
			liqValue: liqValue,
			token0: Pair(pair).token0(),
			token1: Pair(pair).token1()
		});

		return
			GToken($.gtoken).mintGToken(
				address($.launchPair),
				$.rewardPerShare,
				epochsLocked,
				liqInfo
			);
	}

	/// @notice Allows a user to claim their accumulated rewards based on their current stake.
	/// @dev This function will transfer the calculated claimable reward to the user,
	/// 	 update the user's reward attributes, and decrease the rewards reserve.
	/// @param nonce The specific nonce representing a unique staking position of the user.
	/// @return Nonce of the updated GToken for the user after claiming the reward.
	function claimReward(uint256 nonce) external returns (uint256) {
		GovernanceStorage storage $ = _getGovernanceStorage();

		Gainz($.gainzToken).mintGainz();

		address user = msg.sender;
		uint256[] memory nonces = new uint256[](1);
		nonces[0] = nonce;
		(
			uint256 claimableReward,
			GTokenLib.Attributes[] memory attributes
		) = GovernanceLib._claimRewards($, user, nonces);

		require(claimableReward > 0, "Governance: No rewards to claim");

		GTokenLib.Attributes memory attribute = attributes[0];

		attribute.rewardPerShare = $.rewardPerShare;
		attribute.lastClaimEpoch = $.epochs.currentEpoch();

		return GToken($.gtoken).update(user, nonce, attribute);
	}

	function claimRewards(
		uint256[] memory nonces
	) external returns (uint256[] memory) {
		GovernanceStorage storage $ = _getGovernanceStorage();

		Gainz($.gainzToken).mintGainz();

		address user = msg.sender;
		(, GTokenLib.Attributes[] memory attributes) = GovernanceLib
			._claimRewards($, user, nonces);

		for (uint256 i = 0; i < nonces.length; i++) {
			GTokenLib.Attributes memory attribute = attributes[i];

			attribute.rewardPerShare = $.rewardPerShare;
			attribute.lastClaimEpoch = $.epochs.currentEpoch();

			nonces[i] = GToken($.gtoken).update(user, nonces[i], attribute);
		}

		return nonces;
	}

	function unStake(uint256 nonce, uint amount0Min, uint amount1Min) external {
		GovernanceLib.unStake(
			_getGovernanceStorage(),
			nonce,
			amount0Min,
			amount1Min
		);
	}

	// ******* VIEWS *******

	function getGToken() external view returns (address) {
		return _getGovernanceStorage().gtoken;
	}

	function getGainzToken() external view returns (address) {
		return _getGovernanceStorage().gainzToken;
	}

	function rewardsReserve() external view returns (uint256) {
		return _getGovernanceStorage().rewardsReserve;
	}

	function rewardPerShare() external view returns (uint256) {
		return _getGovernanceStorage().rewardPerShare;
	}

	function getClaimableRewards(
		address user,
		uint256[] calldata nonces
	) external view returns (uint256 totalClaimable) {
		GovernanceStorage storage $ = _getGovernanceStorage();

		(, uint256 rpsToAdd) = _addGainzMint(
			Gainz($.gainzToken).stakersGainzToEmit(),
			GToken($.gtoken).totalStakeWeight()
		);

		(totalClaimable, ) = GovernanceLib._calculateClaimableReward(
			user,
			nonces,
			$.gtoken,
			$.rewardPerShare + rpsToAdd
		);
	}

	function launchPair() public view returns (LaunchPair) {
		return _getGovernanceStorage().launchPair;
	}

	function pairListing(
		address pairOwner
	) public view returns (LaunchPair.TokenListing memory) {
		return _getGovernanceStorage().launchPair.pairListing(pairOwner);
	}

	function epochs() public view returns (Epochs.Storage memory) {
		return _getGovernanceStorage().epochs;
	}

	function getRouter() public view returns (address) {
		return _getGovernanceStorage().router;
	}

	function currentEpoch() public view returns (uint256) {
		GovernanceStorage storage $ = _getGovernanceStorage();
		return $.epochs.currentEpoch();
	}

	receive() external payable {}
}
