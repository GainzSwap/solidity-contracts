// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { ERC1155HolderUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";

import { TokenPayment, TokenPayments } from "./libraries/TokenPayments.sol";
import { GToken, GTokenBalance, GTokenLib } from "./tokens/GToken/GToken.sol";
import { Router } from "./Router.sol";
import { Governance } from "./Governance.sol";
import { FullMath } from "./libraries/FullMath.sol";

import { PriceOracle } from "./PriceOracle.sol";
import { OracleLibrary } from "./libraries/OracleLibrary.sol";
import { Epochs } from "./libraries/Epochs.sol";

import "./libraries/utils.sol";
import "./errors.sol";

uint256 constant MIN_LIQ_VALUE_FOR_LISTING = 5_000e18;

/**
 * @title LaunchPair
 * @dev This contract facilitates the creation and management of crowdfunding campaigns for launching new tokens. Participants contribute funds to campaigns, and if the campaign is successful, they receive launchPair tokens in return. If the campaign fails, their contributions are refunded.
 */
contract LaunchPair is OwnableUpgradeable, ERC1155HolderUpgradeable, Errors {
	using TokenPayments for TokenPayment;
	using TokenPayments for address;
	using EnumerableSet for EnumerableSet.UintSet;
	using EnumerableSet for EnumerableSet.AddressSet;
	using Epochs for Epochs.Storage;
	using GTokenLib for GTokenLib.Attributes;

	enum CampaignStatus {
		Pending,
		Funding,
		Failed,
		Success
	}

	struct Campaign {
		address creator;
		uint256 gtokenNonce;
		uint256 goal;
		uint256 deadline;
		uint256 fundsRaised;
		bool isWithdrawn;
		CampaignStatus status;
	}

	struct TokenListing {
		address owner;
		TokenPayment securityGTokenPayment;
		TokenPayment tradeTokenPayment;
		uint256 campaignId;
		address pairedToken;
		uint256 epochsLocked;
	}

	/// @custom:storage-location erc7201:gainz.LaunchPair.storage
	struct MainStorage {
		// Mapping from campaign ID to Campaign struct
		mapping(uint256 => Campaign) campaigns;
		// Mapping from campaign ID to a participant's address to their contribution amount
		mapping(uint256 => mapping(address => uint256)) contributions;
		// Mapping from a user's address to the set of campaign IDs they participated in
		mapping(address => EnumerableSet.UintSet) userCampaigns;
		// Set of all campaign IDs
		EnumerableSet.UintSet activeCampaigns;
		// Total number of campaigns created
		uint256 campaignCount;
		GToken gToken;
		mapping(address => TokenListing) pairListing;
		mapping(uint256 => mapping(address => TokenListing)) participatedListings;
		EnumerableSet.AddressSet allowedPairedTokens;
		mapping(address => address[]) pathToNative;
		address dEDU;
		address gainz;
		address governance;
		address router;
		EnumerableSet.AddressSet pendingTokenListing;
		Epochs.Storage epochs;
	}

	// Event emitted when a new campaign is created
	event CampaignCreated(
		uint256 indexed campaignId,
		address indexed creator,
		uint256 goal,
		uint256 deadline
	);

	// Event emitted when a contribution is made to a campaign
	event ContributionMade(
		uint256 indexed campaignId,
		address indexed contributor,
		uint256 amount
	);

	// Event emitted when tokens are distributed to a participant
	event TokensDistributed(
		uint256 indexed campaignId,
		uint256 indexed gTokenNonce,
		address indexed contributor,
		uint256 amount
	);

	// Event emitted when the campaign creator withdraws funds after a successful campaign
	event FundsWithdrawn(
		uint256 indexed campaignId,
		address indexed creator,
		uint256 amount
	);

	// Event emitted when a refund is issued to a participant after a failed campaign
	event RefundIssued(
		uint256 indexed campaignId,
		address indexed contributor,
		uint256 amount
	);

	// keccak256(abi.encode(uint256(keccak256("gainz.LaunchPair.storage")) - 1)) & ~bytes32(uint256(0xff));
	bytes32 private constant LAUNCHPAIR_STORAGE_LOCATION =
		0x66c8a6ef269fb788d035dbcef8eb7fb6f4739f9cf4d2b8fcd6329d955e05b300;

	function _getMainStorage() private pure returns (MainStorage storage $) {
		assembly {
			$.slot := LAUNCHPAIR_STORAGE_LOCATION
		}
	}

	// Modifier to ensure the caller is the creator of the campaign
	modifier onlyCreator(uint256 _campaignId) {
		require(
			msg.sender == _getMainStorage().campaigns[_campaignId].creator,
			"Not campaign creator"
		);
		_;
	}

	// Modifier to ensure the campaign exists
	modifier campaignExists(uint256 _campaignId) {
		require(
			_getMainStorage().campaigns[_campaignId].creator != address(0),
			"Campaign does not exist"
		);
		_;
	}

	// Modifier to ensure the campaign has not expired
	modifier isNotExpired(uint256 _campaignId) {
		require(
			block.timestamp <=
				_getMainStorage().campaigns[_campaignId].deadline,
			"Campaign expired"
		);
		_;
	}

	// Modifier to ensure the campaign has met its funding goal
	modifier hasMetGoal(uint256 _campaignId) {
		MainStorage storage $ = _getMainStorage();

		require(
			$.campaigns[_campaignId].fundsRaised >=
				$.campaigns[_campaignId].goal,
			"Goal not met"
		);
		_;
	}

	// Modifier to ensure the campaign funds have not been withdrawn yet
	modifier hasNotWithdrawn(uint256 _campaignId) {
		MainStorage storage $ = _getMainStorage();

		require(
			!$.campaigns[_campaignId].isWithdrawn,
			"Funds already withdrawn"
		);
		_;
	}

	// Modifier to ensure the caller is a participant in the specified campaign
	modifier isCampaignParticipant(address user, uint256 _campaignId) {
		MainStorage storage $ = _getMainStorage();

		require(
			$.userCampaigns[user].contains(_campaignId),
			"Not a participant of selected campaign"
		);
		_;
	}

	function initialize(address _gToken) public initializer {
		MainStorage storage $ = _getMainStorage();

		__Ownable_init(msg.sender);
		$.gToken = GToken(_gToken);
	}

	function acquireOwnership() external {
		MainStorage storage $ = _getMainStorage();
		if ($.governance != address(0)) return;

		$.governance = owner();
		_transferOwnership(msg.sender);

		Governance governance = Governance(payable($.governance));
		$.router = governance.getRouter();
		$.epochs = governance.epochs();
		$.gainz = governance.getGainzToken();

		Router router = Router(payable($.router));
		$.dEDU = router.getWrappedNativeToken();

		uint256 balance = address(this).balance;
		if (balance > 0) {
			payable($.dEDU).transfer(balance);
		}
	}

	function addAllowedPairedToken(
		address[] calldata pathToNative
	) external onlyOwner {
		MainStorage storage $ = _getMainStorage();

		require(
			pathToNative[pathToNative.length - 1] == $.dEDU,
			"Invalid path"
		);

		if (pathToNative.length > 1) {
			PriceOracle priceOracle = PriceOracle(
				OracleLibrary.oracleAddress($.router)
			);
			for (uint256 i = 0; i < pathToNative.length - 1; i++) {
				require(
					isERC20(
						priceOracle.pairFor(
							pathToNative[i],
							pathToNative[i + 1]
						)
					),
					"Invalid path"
				);
			}
		}

		$.allowedPairedTokens.add(pathToNative[0]);
		$.pathToNative[pathToNative[0]] = pathToNative;
	}

	/**
	 * @dev Creates a new crowdfunding campaign.
	 * @param _creator The address of the campaign creator.
	 * @return campaignId The ID of the newly created campaign.
	 */
	function _createCampaign(
		address _creator
	) internal returns (uint256 campaignId) {
		MainStorage storage $ = _getMainStorage();

		campaignId = ++$.campaignCount;
		$.campaigns[campaignId] = Campaign({
			creator: payable(_creator),
			goal: 0,
			deadline: 0,
			fundsRaised: 0,
			gtokenNonce: 0,
			isWithdrawn: false,
			status: CampaignStatus.Pending
		});
	}

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
			attributes.epochsLeft(currentEpoch) > 999,
			"Security GToken Payment Expired"
		);

		return
			(attributes.lpDetails.token0 == gainzToken ||
				attributes.lpDetails.token1 == gainzToken) &&
			payment.amount >= MIN_LIQ_VALUE_FOR_LISTING;
	}

	/// @notice Proposes a new pair listing by submitting the required listing fee and GToken payment.
	/// @param securityPayment The GToken payment as security deposit
	/// @param tradeTokenPayment The the trade token to be listed with launchPair distribution amount, if any.
	function createCampaign(
		TokenPayment calldata securityPayment,
		TokenPayment calldata tradeTokenPayment,
		address pairedToken,
		uint256 goal,
		uint256 duration,
		uint256 epochsLocked
	) external {
		require(
			tradeTokenPayment.token != pairedToken,
			"LaunchPair: Paired token cannot be the same as trade token"
		);
		MainStorage storage $ = _getMainStorage();

		require(
			!$.allowedPairedTokens.contains(tradeTokenPayment.token),
			"LaunchPair: Invalid trade token"
		);

		require(
			epochsLocked >= 90 && epochsLocked <= 1080,
			"LaunchPair: Epochs locked (vesting) must be at least 90 epochs and not more than 1080 epochs"
		);

		require(
			$.allowedPairedTokens.contains(pairedToken),
			"LaunchPair: Invalid paired token"
		);
		address tradeToken = tradeTokenPayment.token;

		// Ensure there is no active listing proposal
		require(
			$.pairListing[msg.sender].owner == address(0),
			"LaunchPair: Previous proposal not completed"
		);

		// Validate the trade token and ensure it is not already listed
		bool isNewAddition = $.pendingTokenListing.add(tradeToken);
		require(
			isERC20(tradeToken) &&
				isNewAddition &&
				!isERC20(
					PriceOracle(OracleLibrary.oracleAddress($.router)).pairFor(
						tradeToken,
						pairedToken
					)
				),
			"LaunchPair: Invalid Trade token"
		);

		require(
			_isValidGTokenPaymentForListing(
				securityPayment,
				address($.gToken),
				$.gainz,
				$.epochs.currentEpoch()
			),
			"LaunchPair: Invalid GToken Payment for proposal"
		);
		securityPayment.receiveTokenFor(msg.sender, address(this), $.dEDU);

		require(
			tradeTokenPayment.amount > 0,
			"LaunchPair: Must send potential initial liquidity"
		);
		tradeTokenPayment.receiveTokenFor(msg.sender, address(this), $.dEDU);

		// Update the active listing with the new proposal details
		TokenListing storage listing = $.pairListing[msg.sender];
		listing.owner = msg.sender;
		listing.tradeTokenPayment = tradeTokenPayment;
		listing.securityGTokenPayment = securityPayment;
		listing.pairedToken = pairedToken;
		listing.campaignId = _createCampaign(msg.sender);
		listing.epochsLocked = epochsLocked;

		$.pairListing[listing.owner] = listing;
		$.pairListing[listing.tradeTokenPayment.token] = listing;

		_startCampaign(goal, duration, listing.campaignId);
	}

	function _removeListing(TokenListing memory listing) internal {
		MainStorage storage $ = _getMainStorage();

		delete $.pairListing[listing.owner];
		delete $.pairListing[listing.tradeTokenPayment.token];
		$.pendingTokenListing.remove(listing.tradeTokenPayment.token);
	}

	function _returnListingDeposits(TokenListing memory listing) internal {
		if (listing.securityGTokenPayment.nonce != 0)
			listing.securityGTokenPayment.sendToken(listing.owner);

		if (listing.tradeTokenPayment.amount > 0) {
			listing.tradeTokenPayment.sendToken(listing.owner);
		}

		_removeListing(listing);
	}

	/**
	 * @notice Progresses the new pair listing process for the calling address.
	 *         This function handles the various stages of the listing, including
	 *         voting, launch pad campaign, and liquidity provision.
	 */
	function progressNewPairListing() external {
		MainStorage storage $ = _getMainStorage();

		// Retrieve the token listing associated with the caller's address.
		TokenListing memory listing = $.pairListing[msg.sender];

		// Ensure that a valid listing exists after the potential refresh.
		require(
			listing.owner == msg.sender && listing.campaignId > 0,
			"No listing found"
		);

		// Retrieve details of the existing campaign.
		Campaign storage campaign = $.campaigns[listing.campaignId];

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
			revert("LaunchPair: Funding not complete");
		}

		require(!campaign.isWithdrawn, "LaunchPair: CAMPAIGN_FUNDS_WITHDRAWN");

		uint256 fundsRaised = _markCampaignDone(campaign, listing.campaignId);

		// Return the security GToken payment after successful governance entry.
		if (listing.securityGTokenPayment.nonce != 0)
			listing.securityGTokenPayment.sendToken(listing.owner);

		TokenPayment memory pairedTokenPayment = TokenPayment({
			token: listing.pairedToken,
			nonce: 0,
			amount: fundsRaised
		});

		listing.tradeTokenPayment.approve($.governance);
		pairedTokenPayment.approve($.governance);

		_removeListing(listing);

		uint256 gTokenNonce = Governance(payable($.governance)).createPair(
			listing.tradeTokenPayment,
			pairedTokenPayment,
			$.pathToNative[listing.pairedToken],
			listing.epochsLocked
		);

		// Check to ensure GToken was received
		require(
			$.gToken.balanceOf(address(this), gTokenNonce) > 0,
			"LaunchPair: GToken not received"
		);
		campaign.gtokenNonce = gTokenNonce;
	}

	function _startCampaign(
		uint256 _goal,
		uint256 _duration,
		uint256 _campaignId
	) internal {
		require(
			_goal >= 2_000_000,
			"Goal must be at least 2M units of the token"
		);
		require(_duration >= 30 days, "Duration must be at least 30 days");
		require(_duration <= 180 days, "Duration cannot exceed 180 days");

		MainStorage storage $ = _getMainStorage();

		Campaign storage campaign = $.campaigns[_campaignId];
		require(
			campaign.status == CampaignStatus.Pending,
			"Campaign begun already"
		);

		campaign.goal = _goal;
		campaign.deadline = block.timestamp + _duration;
		campaign.status = CampaignStatus.Funding;

		$.activeCampaigns.add(_campaignId);
		emit CampaignCreated(
			_campaignId,
			msg.sender,
			_goal,
			block.timestamp + _duration
		);
	}

	/**
	 * @dev Contribute to a crowdfunding campaign.
	 * @param _campaignId The ID of the campaign to contribute to.
	 */
	function contribute(
		TokenPayment memory payment,
		uint256 _campaignId
	) external payable campaignExists(_campaignId) isNotExpired(_campaignId) {
		// Validate the payment amount
		if (
			payment.amount < 1 ether ||
			(msg.value > 0 && payment.amount != msg.value)
		) revert InvalidPayment(payment, msg.value);

		MainStorage storage $ = _getMainStorage();
		Campaign storage campaign = $.campaigns[_campaignId];
		require(
			campaign.status == CampaignStatus.Funding,
			"Campaign is not in funding status"
		);
		require(
			$.pairListing[campaign.creator].pairedToken == payment.token,
			"LaunchPair: Invalid token for campaign"
		);

		{
			bool paymentIsNative = msg.value > 0 && payment.token == $.dEDU;

			if (paymentIsNative) payment.token = address(0);
			payment.receiveTokenFor(msg.sender, address(this), $.dEDU);
			if (paymentIsNative) payment.token = $.dEDU;
		}

		uint256 amount = payment.amount;
		campaign.fundsRaised += amount;
		$.contributions[_campaignId][msg.sender] += amount;

		// Add the campaign to the user's participated campaigns if this is their first contribution
		if ($.contributions[_campaignId][msg.sender] == amount) {
			$.userCampaigns[msg.sender].add(_campaignId);
			$.participatedListings[_campaignId][msg.sender] = $.pairListing[
				campaign.creator
			];
		}

		emit ContributionMade(_campaignId, msg.sender, amount);
	}

	function _markCampaignDone(
		Campaign storage campaign,
		uint256 campaignId
	) internal returns (uint256 amount) {
		amount = campaign.fundsRaised;
		campaign.isWithdrawn = true;
		campaign.status = CampaignStatus.Success;

		// Remove the campaign from the set of all campaigns
		_removeCampaignFromActiveCampaigns(campaignId);

		emit FundsWithdrawn(campaignId, campaign.creator, amount);
	}

	/**
	 * @dev Allows a participant to withdraw their share of launchPair tokens
	 *      after a campaign successfully meets its goals.
	 * @param _campaignId The unique identifier of the campaign.
	 * Requirements:
	 * - The campaign must exist.
	 * - The campaign must have achieved its funding goal.
	 * - The sender must be a participant in the specified campaign.
	 */
	function withdrawLaunchPairToken(
		uint256 _campaignId
	)
		external
		campaignExists(_campaignId)
		hasMetGoal(_campaignId)
		isCampaignParticipant(msg.sender, _campaignId)
		returns (uint256 gTokenNonce)
	{
		MainStorage storage $ = _getMainStorage();
		Campaign storage campaign = $.campaigns[_campaignId];

		require(
			campaign.status == CampaignStatus.Success,
			"Campaign must be successful to withdraw tokens"
		);

		uint256 userLiqShare;

		{
			// Fetch total liquidity from the campaign's gToken nonce.
			GTokenBalance memory gTokenBalance = $.gToken.getBalanceAt(
				address(this),
				campaign.gtokenNonce
			);

			require(
				gTokenBalance.attributes.lpDetails.liquidity > 0,
				"No liquidity available for distribution"
			);

			// Calculate user's liquidity share based on contribution proportion.
			uint256 contribution = $.contributions[_campaignId][msg.sender];
			require(
				contribution > 0,
				"No contributions from sender in this campaign"
			);
			$.contributions[_campaignId][msg.sender] = 0;
			_removeCampaignFromUserCampaigns(msg.sender, _campaignId);

			userLiqShare = FullMath.mulDiv(
				contribution,
				gTokenBalance.attributes.lpDetails.liquidity,
				campaign.fundsRaised
			);

			// Split the liquidity between the contract and the user.
			address[] memory addresses = new address[](2);
			uint256[] memory portions = new uint256[](2);

			addresses[0] = address(this);
			portions[0] =
				gTokenBalance.attributes.lpDetails.liquidity -
				userLiqShare;

			addresses[1] = msg.sender;
			portions[1] = userLiqShare;

			uint256[] memory nonces = $.gToken.split(
				campaign.gtokenNonce,
				addresses,
				portions
			);

			// Update the campaign's gToken nonce with the remaining contract liquidity.
			campaign.gtokenNonce = nonces[0];
			gTokenNonce = nonces[1];
		}

		emit TokensDistributed(
			_campaignId,
			gTokenNonce,
			msg.sender,
			userLiqShare
		);
	}

	/**
	 * @dev Request a refund after a failed campaign.
	 * @param _campaignId The ID of the campaign to refund.
	 */
	function getRefunded(
		uint256 _campaignId
	)
		external
		campaignExists(_campaignId)
		isCampaignParticipant(msg.sender, _campaignId)
	{
		MainStorage storage $ = _getMainStorage();

		Campaign storage campaign = $.campaigns[_campaignId];
		require(
			block.timestamp > campaign.deadline &&
				campaign.fundsRaised < campaign.goal,
			"Refund not available"
		);

		uint256 amount = $.contributions[_campaignId][msg.sender];
		require(amount > 0, "No contributions to refund");

		$.contributions[_campaignId][msg.sender] = 0;

		// Update the status to Failed
		campaign.status = CampaignStatus.Failed;
		$.activeCampaigns.remove(_campaignId);

		TokenListing memory listing = $.participatedListings[_campaignId][
			msg.sender
		];
		if (listing.pairedToken == address(0)) {
			// Handle GainzSwap ILO refund
			$.dEDU.sendFungibleToken(amount, msg.sender);
		} else {
			listing.pairedToken.sendFungibleToken(amount, msg.sender);
		}

		_removeCampaignFromUserCampaigns(msg.sender, _campaignId);
		emit RefundIssued(_campaignId, msg.sender, amount);
	}

	/**
	 * @dev Get details of a specific campaign.
	 * @param _campaignId The ID of the campaign to get details of.
	 * @return campaign The Campaign struct containing all details of the campaign.
	 */
	function getCampaignDetails(
		uint256 _campaignId
	) external view returns (Campaign memory) {
		MainStorage storage $ = _getMainStorage();

		return $.campaigns[_campaignId];
	}

	/**
	 * @dev Get all campaign IDs.
	 * @return campaignIds An array of all campaign IDs.
	 */
	function getActiveCampaigns() external view returns (uint256[] memory) {
		MainStorage storage $ = _getMainStorage();

		return $.activeCampaigns.values();
	}

	/**
	 * @dev Get campaign IDs that a user has participated in.
	 * @param user The address of the user.
	 * @return campaignIds An array of campaign IDs that the user has participated in.
	 */
	function getUserCampaigns(
		address user
	) external view returns (uint256[] memory) {
		MainStorage storage $ = _getMainStorage();

		return $.userCampaigns[user].values();
	}

	/**
	 * @dev Remove a campaign from the set of all campaigns after it's successful or failed.
	 * @param campaignId The ID of the campaign to remove.
	 */
	function _removeCampaignFromActiveCampaigns(uint256 campaignId) internal {
		MainStorage storage $ = _getMainStorage();

		$.activeCampaigns.remove(campaignId);
	}

	/**
	 * @dev Remove a campaign from the user's participated campaigns after withdrawal or refund.
	 * @param user The address of the user.
	 * @param campaignId The ID of the campaign to remove.
	 */
	function _removeCampaignFromUserCampaigns(
		address user,
		uint256 campaignId
	) internal {
		MainStorage storage $ = _getMainStorage();

		$.userCampaigns[user].remove(campaignId);
		delete $.participatedListings[campaignId][user];
	}

	function campaigns(
		uint256 campaignId
	) public view returns (Campaign memory) {
		return _getMainStorage().campaigns[campaignId];
	}

	function contributions(
		uint256 campaignId,
		address contributor
	) public view returns (uint256) {
		return _getMainStorage().contributions[campaignId][contributor];
	}

	function campaignCount() public view returns (uint256) {
		return _getMainStorage().campaignCount;
	}

	function pairListing(
		address pairOwner
	) external view returns (TokenListing memory) {
		return _getMainStorage().pairListing[pairOwner];
	}

	function participatedListings(
		uint256 campaignId,
		address participant
	) external view returns (TokenListing memory) {
		return _getMainStorage().participatedListings[campaignId][participant];
	}

	function allowedPairedTokens() external view returns (address[] memory) {
		return _getMainStorage().allowedPairedTokens.values();
	}

	function minLiqValueForListing() public pure returns (uint256) {
		return MIN_LIQ_VALUE_FOR_LISTING;
	}

	receive() external payable {}
}
