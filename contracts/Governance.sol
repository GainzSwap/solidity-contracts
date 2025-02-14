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

uint256 constant MIN_LIQ_VALUE_FOR_LISTING = 5_000e18;

library GovernanceLib {
	using Epochs for Epochs.Storage;
	using GTokenLib for GTokenLib.Attributes;
	using TokenPayments for TokenPayment;
	using TokenPayments for address;
	using Number for uint256;
	using EnumerableSet for EnumerableSet.AddressSet;

	/// @notice Validates the GToken payment for the listing based on the total ADEX amount in liquidity.
	/// @param payment The payment details for the GToken.
	/// @return bool indicating if the GToken payment is valid.
	function _isValidGTokenPaymentForListing(
		TokenPayment calldata payment,
		address gtoken,
		address gainzToken,
		uint256 currentEpoch
	) private view returns (bool) {
		// Ensure the payment token is the correct GToken contract
		if (payment.token != gtoken) {
			return false;
		}

		// Retrieve the GToken attributes for the specified nonce
		GTokenLib.Attributes memory attributes = GToken(gtoken)
			.getBalanceAt(msg.sender, payment.nonce)
			.attributes;

		require(
			attributes.epochsLeft(currentEpoch) >= 1000,
			"Security GToken Payment Expired"
		);

		return
			(attributes.lpDetails.token0 == gainzToken ||
				attributes.lpDetails.token1 == gainzToken) &&
			payment.amount >= MIN_LIQ_VALUE_FOR_LISTING;
	}

	function _calculateClaimableReward(
		address user,
		uint256 nonce,
		address gtoken,
		uint256 rewardPerShare
	)
		internal
		view
		returns (
			uint256 claimableReward,
			GTokenLib.Attributes memory attributes
		)
	{
		attributes = GToken(gtoken).getBalanceAt(user, nonce).attributes;

		claimableReward = FullMath.mulDiv(
			attributes.stakeWeight,
			rewardPerShare - attributes.rewardPerShare,
			FixedPoint128.Q128
		);
	}

	function _claimRewards(
		Governance.GovernanceStorage storage $,
		address user,
		uint256 nonce
	)
		internal
		returns (
			uint256 claimableReward,
			GTokenLib.Attributes memory attributes
		)
	{
		// Calculate rewards to be claimed on unstaking
		(claimableReward, attributes) = _calculateClaimableReward(
			user,
			nonce,
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
		(, GTokenLib.Attributes memory attributes) = _claimRewards(
			$,
			user,
			nonce
		);

		GToken($.gtoken).burn(user, nonce, attributes.supply());

		uint256 liquidity = attributes.lpDetails.liquidity;
		uint256 liquidityToReturn = attributes.epochsLocked == 0
			? liquidity
			: attributes.valueToKeep(liquidity, $.epochs.currentEpoch());
		if (liquidityToReturn < liquidity) {
			$.pairLiqFee[attributes.lpDetails.pair] +=
				liquidity -
				liquidityToReturn;

			// Adjust slippage accordingly
			amount0Min = (amount0Min * liquidityToReturn) / liquidity;
			amount1Min = (amount1Min * liquidityToReturn) / liquidity;
		}

		address token0 = attributes.lpDetails.token0;
		address token1 = attributes.lpDetails.token1;

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

	function proposeNewPairListing(
		Governance.GovernanceStorage storage $,
		TokenPayment calldata securityPayment,
		TokenPayment calldata tradeTokenPayment
	) external {
		address tradeToken = tradeTokenPayment.token;

		// Ensure there is no active listing proposal
		require(
			$.pairOwnerListing[msg.sender].owner == address(0),
			"Governance: Previous proposal not completed"
		);

		// Validate the trade token and ensure it is not already listed
		bool isNewAddition = $.pendingOrListedTokens.add(tradeToken);
		require(
			isERC20(tradeToken) &&
				isNewAddition &&
				!isERC20(
					PriceOracle(OracleLibrary.oracleAddress($.router)).pairFor(
						tradeToken,
						$.wNativeToken
					)
				),
			"Governance: Invalid Trade token"
		);

		if (tradeToken != $.gainzToken) {
			require(
				_isValidGTokenPaymentForListing(
					securityPayment,
					$.gtoken,
					$.gainzToken,
					$.epochs.currentEpoch()
				),
				"Governance: Invalid GToken Payment for proposal"
			);
			securityPayment.receiveTokenFor(
				msg.sender,
				address(this),
				$.wNativeToken
			);
		}

		require(
			tradeTokenPayment.amount > 0,
			"Governance: Must send potential initial liquidity"
		);
		tradeTokenPayment.receiveTokenFor(
			msg.sender,
			address(this),
			$.wNativeToken
		);

		// Update the active listing with the new proposal details
		Governance.TokenListing memory activeListing;
		activeListing.owner = msg.sender;
		activeListing.tradeTokenPayment = tradeTokenPayment;
		activeListing.securityGTokenPayment = securityPayment;
		activeListing.endEpoch = $.epochs.currentEpoch(); // Voting is disabled
		activeListing.campaignId = $.launchPair.createCampaign(msg.sender);

		$.pairOwnerListing[activeListing.owner] = activeListing;
		$.pairOwnerListing[
			activeListing.tradeTokenPayment.token
		] = activeListing;
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

	error InvalidPayment(TokenPayment payment, uint256 value);

	function _getDesiredToken(
		address[] calldata path,
		TokenPayment calldata stakingPayment,
		uint256 amountOutMin
	) internal returns (TokenPayment memory payment) {
		if (path.length == 0) revert InvalidPath(path);

		uint256 amountIn = stakingPayment.amount / 2;

		payment.token = path[path.length - 1];
		payment.amount = payment.token == stakingPayment.token
			? amountIn
			: Router(payable(_getGovernanceStorage().router))
				.swapExactTokensForTokens(
					amountIn,
					amountOutMin,
					path,
					address(this),
					block.timestamp + 1
				)[path.length - 1][0];
	}

	function _receiveAndApprovePayment(
		TokenPayment memory payment,
		address router
	) internal returns (address wNativeToken) {
		wNativeToken = Router(payable(router)).getWrappedNativeToken();
		bool paymentIsNative = payment.token == wNativeToken;

		if (paymentIsNative) payment.token = address(0);
		payment.receiveTokenFor(msg.sender, address(this), wNativeToken);
		if (paymentIsNative) payment.token = wNativeToken;

		// Optimistically approve `router` to spend payment in `_getDesiredToken` call
		payment.approve(router);
	}

	function _computeLiqValue(
		GovernanceStorage storage $,
		TokenPayment memory paymentA,
		TokenPayment memory paymentB,
		address[] calldata pathToNative
	) internal returns (uint256 value) {
		// Validate the pathToNative
		if (
			pathToNative.length < 2 || // `pathToNative` must have valid length
			pathToNative[pathToNative.length - 1] != $.wNativeToken || // The last token must be the native token (i.e., the reference token)
			(pathToNative[0] != paymentA.token &&
				pathToNative[0] != paymentB.token) // The first token must be one of the payment tokens
		) revert InvalidPath(pathToNative);

		// Determine which payment token to use for the conversion
		TokenPayment memory payment = pathToNative[0] == paymentA.token
			? paymentA
			: paymentB;

		// Get the PriceOracle instance
		PriceOracle priceOracle = PriceOracle(
			OracleLibrary.oracleAddress($.router)
		);

		// Start with the payment amount
		value = payment.amount;

		// Convert the payment amount to the native token using the provided path
		for (uint256 i = 0; i < pathToNative.length - 1; i++) {
			value = priceOracle.updateAndConsult(
				pathToNative[i],
				pathToNative[i + 1],
				value
			);
		}

		// Ensure the computed value is valid
		require(value > 0, "Governance: INVALID_COMPUTED_LIQ_VALUE");
	}

	function stake(
		TokenPayment calldata payment,
		uint256 epochsLocked,
		address[][3] calldata paths, // 0 -> pathA, 1 -> pathB, 2 -> pathToNative
		uint256 amountOutMinA,
		uint256 amountOutMinB
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
			_receiveAndApprovePayment(payment, $.router);

			// Swap the payment tokens into the desired tokens
			TokenPayment memory paymentA = _getDesiredToken(
				paths[0],
				payment,
				amountOutMinA
			);
			TokenPayment memory paymentB = _getDesiredToken(
				paths[1],
				payment,
				amountOutMinB
			);
			require(
				paymentA.token != paymentB.token,
				"Governance: INVALID_PATH_VALUES"
			);

			// Approve the router to spend the swapped tokens
			if (paymentA.token != payment.token) paymentA.approve($.router);
			if (paymentB.token != payment.token) paymentB.approve($.router);

			// Set liquidity info
			(liqInfo.token0, liqInfo.token1) = paymentA.token < paymentB.token
				? (paymentA.token, paymentB.token)
				: (paymentB.token, paymentA.token);

			// Add liquidity using the router
			(, , liqInfo.liquidity, liqInfo.pair) = Router(payable($.router))
				.addLiquidity(paymentA, paymentB, 0, 0, block.timestamp + 1);

			// Compute the liquidity value
			liqInfo.liqValue = _computeLiqValue($, paymentA, paymentB, paths[2]) * 2;
		}

		// Mint GToken tokens for the user
		return
			GToken($.gtoken).mintGToken(
				msg.sender,
				$.rewardPerShare,
				epochsLocked,
				liqInfo
			);
	}

	function _addGainzMint(
		uint amount,
		uint256 totalStakeWeight
	) private pure returns (uint _rewardsReserve, uint _rewardPerShare) {
		if (totalStakeWeight > 0) {
			// Update the rewards reserve
			_rewardsReserve = amount;
			_rewardPerShare = FullMath.mulDiv(
				amount,
				FixedPoint128.Q128,
				totalStakeWeight
			);
		}
	}

	/// @notice Updates the rewards reserve by adding the specified amount.
	function updateRewardReserve() external {
		GovernanceStorage storage $ = _getGovernanceStorage();

		// Transfer the amount of Gainz tokens to the contract
		uint256 amount = IERC20($.gainzToken).balanceOf(address(this)) -
			$.rewardsReserve;
		uint _rewardPerShare;

		uint256 totalStakeWeight = GToken($.gtoken).totalStakeWeight();
		(amount, _rewardPerShare) = _addGainzMint(amount, totalStakeWeight);
		// Update the rewards reserve
		$.rewardsReserve += amount;
		$.rewardPerShare += _rewardPerShare;
	}

	/// @notice Allows a user to claim their accumulated rewards based on their current stake.
	/// @dev This function will transfer the calculated claimable reward to the user,
	/// 	 update the user's reward attributes, and decrease the rewards reserve.
	/// @param nonce The specific nonce representing a unique staking position of the user.
	/// @return Nonce of the updated GToken for the user after claiming the reward.
	function claimRewards(uint256 nonce) external returns (uint256) {
		GovernanceStorage storage $ = _getGovernanceStorage();

		Gainz($.gainzToken).mintGainz();

		address user = msg.sender;
		(
			uint256 claimableReward,
			GTokenLib.Attributes memory attributes
		) = GovernanceLib._claimRewards($, user, nonce);

		require(claimableReward > 0, "Governance: No rewards to claim");

		attributes.rewardPerShare = $.rewardPerShare;
		attributes.lastClaimEpoch = $.epochs.currentEpoch();

		return GToken($.gtoken).update(user, nonce, attributes);
	}

	function unStake(uint256 nonce, uint amount0Min, uint amount1Min) external {
		GovernanceLib.unStake(
			_getGovernanceStorage(),
			nonce,
			amount0Min,
			amount1Min
		);
	}

	function _returnListingDeposits(TokenListing memory listing) internal {
		GovernanceStorage storage $ = _getGovernanceStorage();

		if (listing.securityGTokenPayment.nonce != 0)
			listing.securityGTokenPayment.sendToken(listing.owner);

		if (listing.tradeTokenPayment.amount > 0) {
			listing.tradeTokenPayment.sendToken(listing.owner);
		}

		delete $.pairOwnerListing[msg.sender];
		delete $.pairOwnerListing[listing.tradeTokenPayment.token];
		$.pendingOrListedTokens.remove(listing.tradeTokenPayment.token);
	}

	/**
	 * @notice Progresses the new pair listing process for the calling address.
	 *         This function handles the various stages of the listing, including
	 *         voting, launch pad campaign, and liquidity provision.
	 */
	function progressNewPairListing() external {
		GovernanceStorage storage $ = _getGovernanceStorage();

		// Retrieve the token listing associated with the caller's address.
		TokenListing storage listing = $.pairOwnerListing[msg.sender];

		// Ensure that a valid listing exists after the potential refresh.
		require(
			listing.owner == msg.sender && listing.campaignId > 0,
			"No listing found"
		);

		// Retrieve details of the existing campaign.
		LaunchPair.Campaign memory campaign = $.launchPair.getCampaignDetails(
			listing.campaignId
		);

		if (campaign.goal > 0 && block.timestamp > campaign.deadline) {
			if (campaign.fundsRaised < campaign.goal) {
				campaign.status = LaunchPair.CampaignStatus.Failed;
			} else {
				campaign.status = LaunchPair.CampaignStatus.Success;
			}
		}

		// Check the campaign status.
		if (campaign.status != LaunchPair.CampaignStatus.Success) {
			// If the campaign failed, return the deposits to the listing owner.
			if (campaign.status == LaunchPair.CampaignStatus.Failed) {
				_returnListingDeposits(listing);
				return;
			}

			// If the campaign is not complete, revert the transaction.
			revert("Governance: Funding not complete");
		}

		require(!campaign.isWithdrawn, "Governance: CAMPAIGN_FUNDS_WITHDRAWN");

		// Store the current balance of the contract before withdrawing funds.
		uint256 ethBal = address(this).balance;
		// Withdraw the funds raised in the campaign.
		uint256 fundsRaised = $.launchPair.withdrawFunds(listing.campaignId);
		// Ensure that the funds were successfully withdrawn.
		require(
			ethBal + fundsRaised == address(this).balance,
			"Governance: Funds not withdrawn for campaign"
		);

		listing.tradeTokenPayment.approve($.router);

		// Create the trading pair using the router and receive GToken tokens.
		delete $.pairOwnerListing[listing.tradeTokenPayment.token];
		(address pair, uint256 liquidity) = Router(payable($.router))
			.createPair{ value: fundsRaised }(
			listing.tradeTokenPayment,
			TokenPayment({
				token: $.wNativeToken,
				nonce: 0,
				amount: fundsRaised
			})
		);

		uint256 gTokenNonce = GToken($.gtoken).mintGToken(
			address(this),
			$.rewardPerShare,
			60,
			LiquidityInfo({
				pair: pair,
				liquidity: liquidity,
				liqValue: fundsRaised,
				token0: Pair(pair).token0(),
				token1: Pair(pair).token1()
			})
		);

		// Return the security GToken payment after successful governance entry.
		if (listing.securityGTokenPayment.nonce != 0)
			listing.securityGTokenPayment.sendToken(listing.owner);

		TokenPayment memory gTokenPayment = TokenPayment({
			amount: GToken($.gtoken).balanceOf(address(this), gTokenNonce),
			nonce: gTokenNonce,
			token: $.gtoken
		});

		// Approve the GToken tokens for use by the launch pair contract.
		gTokenPayment.approve(address($.launchPair));
		// Transfer the GToken tokens to the launch pair contract.
		$.launchPair.receiveGToken(gTokenPayment, listing.campaignId);
		// complete the proposal
		delete $.pairOwnerListing[msg.sender];
	}

	/// @notice Proposes a new pair listing by submitting the required listing fee and GToken payment.
	/// @param securityPayment The GToken payment as security deposit
	/// @param tradeTokenPayment The the trade token to be listed with launchPair distribution amount, if any.
	function proposeNewPairListing(
		TokenPayment calldata securityPayment,
		TokenPayment calldata tradeTokenPayment
	) external {
		GovernanceLib.proposeNewPairListing(
			_getGovernanceStorage(),
			securityPayment,
			tradeTokenPayment
		);
	}

	// ******* VIEWS *******

	function getGToken() external view returns (address) {
		return _getGovernanceStorage().gtoken;
	}

	function rewardsReserve() external view returns (uint256) {
		return _getGovernanceStorage().rewardsReserve;
	}

	function rewardPerShare() external view returns (uint256) {
		return _getGovernanceStorage().rewardPerShare;
	}

	function getClaimableRewards(
		address user,
		uint256 nonce
	) external view returns (uint256 totalClaimable) {
		GovernanceStorage storage $ = _getGovernanceStorage();

		(, uint256 rpsToAdd) = _addGainzMint(
			Gainz($.gainzToken).stakersGainzToEmit(),
			GToken($.gtoken).totalStakeWeight()
		);

		(totalClaimable, ) = GovernanceLib._calculateClaimableReward(
			user,
			nonce,
			$.gtoken,
			$.rewardPerShare + rpsToAdd
		);
	}

	function launchPair() public view returns (LaunchPair) {
		return _getGovernanceStorage().launchPair;
	}

	function pairListing(
		address pairOwner
	) public view returns (Governance.TokenListing memory) {
		return _getGovernanceStorage().pairOwnerListing[pairOwner];
	}

	function epochs() public view returns (Epochs.Storage memory) {
		return _getGovernanceStorage().epochs;
	}

	function getRouter() public view returns (address) {
		return _getGovernanceStorage().router;
	}

	function minLiqValueForListing() public pure returns (uint256) {
		return MIN_LIQ_VALUE_FOR_LISTING;
	}

	function currentEpoch() public view returns (uint256) {
		GovernanceStorage storage $ = _getGovernanceStorage();
		return $.epochs.currentEpoch();
	}

	receive() external payable {}
}
