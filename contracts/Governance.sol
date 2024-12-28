// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { ERC1155HolderUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

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

import { Pair } from "./Pair.sol";
import { Router } from "./Router.sol";
import { PriceOracle } from "./PriceOracle.sol";
import { LaunchPair } from "./LaunchPair.sol";

import "./types.sol";
import "./errors.sol";

uint256 constant LISTING_FEE = 20e18;

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
		address gainzToken
	) private view returns (bool) {
		// Ensure the payment token is the correct GToken contract
		if (payment.token != gtoken) {
			return false;
		}

		// Retrieve the GToken attributes for the specified nonce
		GTokenLib.Attributes memory attributes = GToken(gtoken)
			.getBalanceAt(msg.sender, payment.nonce)
			.attributes;

		return
			(attributes.lpDetails.token0 == gainzToken ||
				attributes.lpDetails.token1 == gainzToken) &&
			payment.amount >= 1_000e18;
	}

	/**
	 * @notice Ends the voting process for the active token listing.
	 * @dev This function ensures that the voting period has ended before finalizing the listing.
	 */
	function endVoting(Governance.GovernanceStorage storage $) public {
		require(
			$.activeListing.endEpoch <= $.epochs.currentEpoch(),
			"Voting not complete"
		);

		// Finalize the listing and store it under the owner's address.
		$.pairOwnerListing[$.activeListing.owner] = $.activeListing;
		delete $.activeListing; // Clear the active listing to prepare for the next one.
	}

	function addReward(
		Governance.GovernanceStorage storage $,
		TokenPayment calldata payment
	) public {
		uint256 rewardAmount = payment.amount;
		require(
			rewardAmount > 0,
			"Governance: Reward amount must be greater than zero"
		);
		require(
			payment.token == $.gainzToken,
			"Governance: Invalid reward payment"
		);
		payment.receiveTokenFor(msg.sender, address(this), $.wNativeToken);

		uint256 protocolAmount;
		(rewardAmount, protocolAmount) = rewardAmount.take(
			(rewardAmount * 3) / 10
		); // 30% for protocol fee

		uint256 totalStakeWeight = GToken($.gtoken).totalStakeWeight();
		if (totalStakeWeight > 0) {
			$.rewardPerShare += FullMath.mulDiv(
				rewardAmount,
				FixedPoint128.Q128,
				totalStakeWeight
			);
		}

		$.protocolFees += protocolAmount;
		$.rewardsReserve += rewardAmount;
	}

	function _calculateClaimableReward(
		Governance.GovernanceStorage storage $,
		address user,
		uint256 nonce
	)
		internal
		view
		returns (
			uint256 claimableReward,
			GTokenLib.Attributes memory attributes
		)
	{
		attributes = GToken($.gtoken).getBalanceAt(user, nonce).attributes;

		claimableReward = FullMath.mulDiv(
			attributes.stakeWeight,
			$.rewardPerShare - attributes.rewardPerShare,
			FixedPoint128.Q128
		);
	}

	function unStake(
		Governance.GovernanceStorage storage $,
		uint256 nonce,
		uint amount0Min,
		uint amount1Min
	) external {
		address user = msg.sender;

		// Calculate rewards to be claimed on unstaking
		(
			uint256 claimableReward,
			GTokenLib.Attributes memory attributes
		) = _calculateClaimableReward($, user, nonce);

		// Transfer the claimable rewards to the user, if any
		if (claimableReward > 0) {
			$.rewardsReserve -= claimableReward;
			IERC20($.gainzToken).transfer(user, claimableReward);
		}

		// Calculate the amount of GToken tokens to return to the user
		uint256 liquidity = attributes.lpDetails.liquidity;
		uint256 liquidityToReturn = attributes.epochsLocked == 0
			? liquidity
			: attributes.valueToKeep(
				liquidity,
				attributes.epochsElapsed($.epochs.currentEpoch())
			);

		Pair pair = Pair(
			PriceOracle(OracleLibrary.oracleAddress($.router)).pairFor(
				attributes.lpDetails.token0,
				attributes.lpDetails.token1
			)
		);

		if (liquidityToReturn < liquidity) {
			address feeTo = Router(payable($.router)).feeTo();
			require(
				feeTo != address(0) && feeTo != address(this),
				"Governance: INVALID_FEE_TO_ADDRESS"
			);

			pair.transfer(feeTo, liquidity - liquidityToReturn);

			// Adjust slippage accordingly
			amount0Min = (amount0Min * liquidityToReturn) / liquidity;
			amount1Min = (amount1Min * liquidityToReturn) / liquidity;
		}

		// Transfer GToken tokens back to the user
		pair.approve($.router, liquidityToReturn);
		(uint256 amount0, uint256 amount1) = Router(payable($.router))
			.removeLiquidity(
				attributes.lpDetails.token0,
				attributes.lpDetails.token1,
				liquidityToReturn,
				amount0Min,
				amount1Min,
				address(this),
				block.timestamp + 1
			);

		// Set these values to 0 and updating the atttributes at nonce effectively burns the token
		attributes.lpDetails.liquidity = 0;
		attributes.lpDetails.liqValue = 0;
		nonce = GToken($.gtoken).update(user, nonce, attributes);

		attributes.lpDetails.token0.sendFungibleToken(amount0, user);
		attributes.lpDetails.token1.sendFungibleToken(amount1, user);
	}

	function proposeNewPairListing(
		Governance.GovernanceStorage storage $,
		TokenPayment calldata listingFeePayment,
		TokenPayment calldata securityPayment,
		TokenPayment calldata tradeTokenPayment
	) external {
		endVoting($);

		address tradeToken = tradeTokenPayment.token;

		// Ensure there is no active listing proposal
		require(
			$.pairOwnerListing[msg.sender].owner == address(0) &&
				$.activeListing.owner == address(0),
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

		// Check if the correct listing fee amount is provided
		require(
			listingFeePayment.amount == LISTING_FEE,
			"Governance: Invalid sent listing fee"
		);
		// Add the listing fee to the rewards pool
		addReward($, listingFeePayment);

		require(
			_isValidGTokenPaymentForListing(
				securityPayment,
				$.gtoken,
				$.gainzToken
			),
			"Governance: Invalid GToken Payment for proposal"
		);
		securityPayment.receiveTokenFor(
			msg.sender,
			address(this),
			$.wNativeToken
		);

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
		$.activeListing.owner = msg.sender;
		$.activeListing.tradeTokenPayment = tradeTokenPayment;
		$.activeListing.securityGTokenPayment = securityPayment;
		$.activeListing.endEpoch = $.epochs.currentEpoch() + 3;
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
	}

	function runInit(
		address protocolFeesCollector_,
		address proxyAdmin
	) public {
		GovernanceStorage storage $ = _getGovernanceStorage();

		$.launchPair = DeployLaunchPair.newLaunchPair($.gtoken, proxyAdmin);

		require(
			protocolFeesCollector_ != address(0) &&
				$.protocolFeesCollector == address(0),
			"Invalid Protocol Fees collector"
		);
		$.protocolFeesCollector = protocolFeesCollector_;
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
		// Early return if either payment{A,B} is native
		if (paymentA.token == $.wNativeToken) return paymentA.amount;
		if (paymentB.token == $.wNativeToken) return paymentB.amount;

		if (
			// `pathToNative` has valid length
			pathToNative.length < 2 || // The last token must be native token (i.e the reference token)
			pathToNative[pathToNative.length - 1] != $.wNativeToken || //  The first token must be one of the payments' token
			!(pathToNative[0] == paymentA.token ||
				pathToNative[0] == paymentB.token)
		) revert InvalidPath(pathToNative);

		TokenPayment memory payment = pathToNative[0] == paymentA.token
			? paymentA
			: paymentB;
		PriceOracle priceOracle = PriceOracle(
			OracleLibrary.oracleAddress($.router)
		);

		// Start with payment amount
		value = payment.amount;
		for (uint256 i; i < pathToNative.length - 1; i++) {
			value = priceOracle.updateAndConsult(
				pathToNative[i],
				pathToNative[i + 1],
				value
			);
		}

		require(value > 0, "Governance: INVALID_COMPUTED_LIQ_VALUE");
	}

	function stake(
		TokenPayment calldata payment,
		uint256 epochsLocked,
		address[][3] calldata paths, // 0 -> pathA, 1 -> pathB, 2 -> pathToNative
		uint256 amountOutMinA,
		uint256 amountOutMinB
	) external payable returns (uint256) {
		if (
			payment.amount == 0 ||
			(msg.value > 0 && payment.amount != msg.value)
		) revert InvalidPayment(payment, msg.value);

		GovernanceStorage storage $ = _getGovernanceStorage();

		LiquidityInfo memory liqInfo;
		{
			_receiveAndApprovePayment(payment, $.router);

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

			if (paymentA.token != payment.token) paymentA.approve($.router);
			if (paymentB.token != payment.token) paymentB.approve($.router);

			// Set liquidity info
			(liqInfo.token0, liqInfo.token1) = paymentA.token < paymentB.token
				? (paymentA.token, paymentB.token)
				: (paymentB.token, paymentA.token);

			(, , liqInfo.liquidity, liqInfo.pair) = Router(payable($.router))
				.addLiquidity(paymentA, paymentB, 0, 0, block.timestamp + 1);

			liqInfo.liqValue = payment.token == $.wNativeToken
				? msg.value / 2
				: _computeLiqValue($, paymentA, paymentB, paths[2]);
		}

		return
			GToken($.gtoken).mintGToken(
				msg.sender,
				$.rewardPerShare,
				epochsLocked,
				$.epochs.currentEpoch(),
				liqInfo
			);
	}

	/// @notice Updates the rewards reserve by adding the specified amount.
	function updateRewardReserve() external {
		GovernanceStorage storage $ = _getGovernanceStorage();

		// Transfer the amount of Gainz tokens to the contract
		uint256 amount = IERC20($.gainzToken).balanceOf(address(this)) -
			$.rewardsReserve;

		uint256 totalStakeWeight = GToken($.gtoken).totalStakeWeight();
		if (totalStakeWeight > 0) {
			// Update the rewards reserve
			$.rewardsReserve += amount;
			$.rewardPerShare += FullMath.mulDiv(
				amount,
				FixedPoint128.Q128,
				totalStakeWeight
			);
		}
	}

	/// @notice Allows a user to claim their accumulated rewards based on their current stake.
	/// @dev This function will transfer the calculated claimable reward to the user,
	/// 	 update the user's reward attributes, and decrease the rewards reserve.
	/// @param nonce The specific nonce representing a unique staking position of the user.
	/// @return Nonce of the updated GToken for the user after claiming the reward.
	function claimRewards(uint256 nonce) external returns (uint256) {
		GovernanceStorage storage $ = _getGovernanceStorage();

		address user = msg.sender;
		(
			uint256 claimableReward,
			GTokenLib.Attributes memory attributes
		) = GovernanceLib._calculateClaimableReward($, user, nonce);

		require(claimableReward > 0, "Governance: No rewards to claim");

		$.rewardsReserve -= claimableReward;
		attributes.rewardPerShare = $.rewardPerShare;
		attributes.lastClaimEpoch = $.epochs.currentEpoch();

		IERC20($.gainzToken).transfer(user, claimableReward);
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

	function _checkProposalPass(
		uint256 value,
		uint256 thresholdValue
	) private pure returns (bool) {
		console.log("Value: %s, threshold %s", value, thresholdValue);
		return thresholdValue > 0 && value >= (thresholdValue * 51) / 100;
	}

	function _returnListingDeposits(TokenListing memory listing) internal {
		listing.securityGTokenPayment.sendToken(listing.owner);

		if (listing.tradeTokenPayment.amount > 0) {
			listing.tradeTokenPayment.sendToken(listing.owner);
		}
		delete _getGovernanceStorage().pairOwnerListing[msg.sender];
		_getGovernanceStorage().pendingOrListedTokens.remove(
			listing.tradeTokenPayment.token
		);
	}

	function _createFundRaisingCampaignForListing(
		TokenListing storage listing
	) private returns (bool) {
		require(
			listing.campaignId == 0,
			"Governance: Campaign Created already for Listing"
		);

		GovernanceStorage storage $ = _getGovernanceStorage();

		// Check if the proposal passes both the total GToken amount and the voting requirements.
		bool passedForTotalGToken = _checkProposalPass(
			listing.totalGTokenAmount,
			GToken($.gtoken).totalSupply()
		);
		bool passedForYesVotes = _checkProposalPass(
			listing.yesVote,
			listing.yesVote + listing.noVote
		);
		if (!(passedForTotalGToken && passedForYesVotes)) {
			console.log("NOt passed");
			// If the proposal did not pass, return the deposits to the listing owner.
			_returnListingDeposits(listing);
			return false;
		}

		// Create a new campaign for the listing owner.
		listing.campaignId = $.launchPair.createCampaign(listing.owner);
		return true;
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

		// If no listing is found for the sender, end the current voting session.
		if (listing.owner == address(0)) {
			GovernanceLib.endVoting($); // End the current voting session if no valid listing exists.
			listing = $.pairOwnerListing[msg.sender]; // Refresh listing after ending the vote.
		}

		// Ensure that a valid listing exists after the potential refresh.
		require(listing.owner != address(0), "No listing found");

		if (listing.campaignId == 0) {
			console.log("creating..");

			_createFundRaisingCampaignForListing(listing);
		} else {
			// Retrieve details of the existing campaign.
			LaunchPair.Campaign memory campaign = $
				.launchPair
				.getCampaignDetails(listing.campaignId);

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
					console.log("failed");

					_returnListingDeposits(listing);
					return;
				}

				// If the campaign is not complete, revert the transaction.
				revert("Governance: Funding not complete");
			}

			require(
				!campaign.isWithdrawn,
				"Governance: CAMPAIGN_FUNDS_WITHDRAWN"
			);

			// Store the current balance of the contract before withdrawing funds.
			uint256 ethBal = address(this).balance;
			// Withdraw the funds raised in the campaign.
			uint256 fundsRaised = $.launchPair.withdrawFunds(
				listing.campaignId
			);
			// Ensure that the funds were successfully withdrawn.
			require(
				ethBal + fundsRaised == address(this).balance,
				"Governance: Funds not withdrawn for campaign"
			);

			listing.tradeTokenPayment.approve($.router);

			// Create the trading pair using the router and receive GToken tokens.
			(address pair, uint256 liquidity) = Router(payable($.router))
				.createPair{ value: fundsRaised }(
				listing.tradeTokenPayment,
				TokenPayment({
					token: $.wNativeToken,
					nonce: 0,
					amount: fundsRaised
				})
			);

			uint liqValue = fundsRaised / 2;

			uint256 gTokenNonce = GToken($.gtoken).mintGToken(
				address(this),
				$.rewardPerShare,
				GTokenLib.MAX_EPOCHS_LOCK,
				$.epochs.currentEpoch(),
				LiquidityInfo({
					pair: pair,
					liquidity: liquidity,
					liqValue: liqValue,
					token0: Pair(pair).token0(),
					token1: Pair(pair).token1()
				})
			);

			// Return the security GToken payment after successful governance entry.
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

			console.log("done");
		}
	}

	/**
	 * @notice Allows users to vote on whether a new token pair should be listed.
	 * @param gTokenPayment The gToken payment details used for voting.
	 * @param tradeToken The address of the trade token being voted on.
	 * @param shouldList A boolean indicating the user's vote (true for yes, false for no).
	 */
	function vote(
		TokenPayment calldata gTokenPayment,
		address tradeToken,
		bool shouldList
	) external {
		GovernanceStorage storage $ = _getGovernanceStorage();
		address user = msg.sender;

		require($.activeListing.endEpoch > currentEpoch(), "Voting complete");

		// Ensure that the trade token is valid and active for voting.
		require(
			isERC20(tradeToken) &&
				$.activeListing.tradeTokenPayment.token == tradeToken,
			"Token not active"
		);

		address userLastVotedToken = $.userVote[user];
		require(
			userLastVotedToken == address(0) ||
				userLastVotedToken == $.activeListing.tradeTokenPayment.token,
			"Please recall previous votes"
		);
		require(gTokenPayment.token == $.gtoken, "Governance: Invalid Payment");

		// Calculate the user's vote power based on their gToken attributes.
		GTokenBalance memory gTokenBalance = GToken($.gtoken).getBalanceAt(
			user,
			gTokenPayment.nonce
		);
		GTokenLib.Attributes memory attributes = gTokenBalance.attributes;
		uint256 epochsLeft = attributes.epochsLeft(
			attributes.epochsElapsed($.epochs.currentEpoch())
		);

		require(
			epochsLeft >= 360,
			"GToken expired, must have at least 360 epochs left to vote with"
		);

		uint256 votePower = attributes.votePower(epochsLeft);

		// Receive the gToken payment and record the user's vote.
		gTokenPayment.receiveSFT();
		$.userVotes[user].add(gTokenPayment.nonce);

		// Apply the user's vote to the active listing.
		if (shouldList) {
			$.activeListing.yesVote += votePower;
		} else {
			$.activeListing.noVote += votePower;
		}

		// Update the total GToken amount and record the user's vote for the trade token.
		$.activeListing.totalGTokenAmount += gTokenBalance.amount;
		$.userVote[user] = tradeToken;
	}

	/// @notice Proposes a new pair listing by submitting the required listing fee and GToken payment.
	/// @param listingFeePayment The payment details for the listing fee.
	/// @param securityPayment The ADEX payment as security deposit
	/// @param tradeTokenPayment The the trade token to be listed with launchPair distribution amount, if any.
	function proposeNewPairListing(
		TokenPayment calldata listingFeePayment,
		TokenPayment calldata securityPayment,
		TokenPayment calldata tradeTokenPayment
	) external {
		GovernanceLib.proposeNewPairListing(
			_getGovernanceStorage(),
			listingFeePayment,
			securityPayment,
			tradeTokenPayment
		);
	}

	/**
	 * @notice Allows users to recall their vote tokens after voting has ended or been canceled.
	 */
	function recallVoteToken() external {
		GovernanceStorage storage $ = _getGovernanceStorage(); // Access the main storage

		address user = msg.sender;
		address tradeToken = $.userVote[user];
		EnumerableSet.UintSet storage userVoteNonces = $.userVotes[user];

		// Ensure the user has votes to recall.
		require(userVoteNonces.length() > 0, "No vote found");

		if (tradeToken != address(0)) {
			if (tradeToken == $.activeListing.tradeTokenPayment.token) {
				GovernanceLib.endVoting($);
			}
		}

		// Recall up to 10 vote tokens at a time.
		uint256 count = 0;
		while (count < 10 && userVoteNonces.length() > 0) {
			count++;

			uint256 nonce = userVoteNonces.at(userVoteNonces.length() - 1);
			userVoteNonces.remove(nonce);
			GToken($.gtoken).safeTransferFrom(
				address(this),
				user,
				nonce,
				GToken($.gtoken).balanceOf(address(this), nonce),
				""
			);
		}

		if (userVoteNonces.length() == 0) {
			delete $.userVote[user]; // Clear the user's vote record.
		}
	}

	function getUserActiveVoteGTokenNonces(
		address voter
	) public view returns (uint256[] memory) {
		GovernanceStorage storage $ = _getGovernanceStorage(); // Access the main storage
		return $.userVotes[voter].values();
	}

	function protocolFees() public view returns (uint256) {
		return _getGovernanceStorage().protocolFees;
	}

	function gtoken() public view returns (address) {
		return _getGovernanceStorage().gtoken;
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
		(totalClaimable, ) = GovernanceLib._calculateClaimableReward(
			_getGovernanceStorage(),
			user,
			nonce
		);
	}

	function launchPair() public view returns (LaunchPair) {
		return _getGovernanceStorage().launchPair;
	}

	function activeListing()
		public
		view
		returns (Governance.TokenListing memory)
	{
		return _getGovernanceStorage().activeListing;
	}

	function pairOwnerListing(
		address pairOwner
	) public view returns (Governance.TokenListing memory) {
		return _getGovernanceStorage().pairOwnerListing[pairOwner];
	}

	function epochs() public view returns (Epochs.Storage memory) {
		return _getGovernanceStorage().epochs;
	}

	function userVote(address user) public view returns (address) {
		return _getGovernanceStorage().userVote[user];
	}

	function listing_fees() public pure returns (uint256) {
		return LISTING_FEE;
	}

	function currentEpoch() public view returns (uint256) {
		GovernanceStorage storage $ = _getGovernanceStorage();
		return $.epochs.currentEpoch();
	}

	receive() external payable {}
}
