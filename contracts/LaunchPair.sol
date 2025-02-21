// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { ERC1155HolderUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";

import { TokenPayment, TokenPayments } from "./libraries/TokenPayments.sol";
import { GToken, GTokenBalance } from "./tokens/GToken/GToken.sol";
import { Router } from "./Router.sol";
import { Governance } from "./Governance.sol";
import { FullMath } from "./libraries/FullMath.sol";

import "hardhat/console.sol";

/**
 * @title LaunchPair
 * @dev This contract facilitates the creation and management of crowdfunding campaigns for launching new tokens. Participants contribute funds to campaigns, and if the campaign is successful, they receive launchPair tokens in return. If the campaign fails, their contributions are refunded.
 */
contract LaunchPair is OwnableUpgradeable, ERC1155HolderUpgradeable {
	using TokenPayments for TokenPayment;
	using EnumerableSet for EnumerableSet.UintSet;

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

	/**
	 * @dev Creates a new crowdfunding campaign.
	 * @param _creator The address of the campaign creator.
	 * @return campaignId The ID of the newly created campaign.
	 */
	function createCampaign(
		address _creator
	) external onlyOwner returns (uint256 campaignId) {
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

	function receiveGToken(
		TokenPayment calldata payment,
		uint256 _campaignId
	) external onlyOwner campaignExists(_campaignId) hasMetGoal(_campaignId) {
		MainStorage storage $ = _getMainStorage();

		require(
			payment.amount > 0 &&
				payment.nonce > 0 &&
				address($.gToken) == payment.token,
			"LaunchPair: Invalid GToken received"
		);

		Campaign storage campaign = $.campaigns[_campaignId];
		require(
			campaign.gtokenNonce == 0,
			"Launchpair: Campaign received gToken already"
		);
		campaign.gtokenNonce = payment.nonce;

		payment.receiveSFT();
	}

	/**
	 * @dev Starts a created campaign.
	 * @param _goal The funding goal for the campaign.
	 * @param _duration The duration of the campaign in seconds.
	 * @param _campaignId The ID of the newly created campaign.
	 */
	function startCampaign(
		uint256 _goal,
		uint256 _duration,
		uint256 _campaignId
	) external onlyCreator(_campaignId) {
		require(
			_goal >= 25_000 ether &&
				_duration >= 7 days &&
				_duration <= 180 days,
			"Invalid input"
		);
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
		uint256 _campaignId,
		uint256 referrerId
	) external payable campaignExists(_campaignId) isNotExpired(_campaignId) {
		require(msg.value >= 1 ether, "Minimum contribution is 1 $EDU");
		
		MainStorage storage $ = _getMainStorage();

		Router router = Router(
			payable(Governance(payable(owner())).getRouter())
		);

		uint256 weiAmount = msg.value;
		payable(router.feeTo()).transfer(msg.value);

		Campaign storage campaign = $.campaigns[_campaignId];
		require(
			campaign.status == CampaignStatus.Funding,
			"Campaign is not in funding status"
		);

		campaign.fundsRaised += weiAmount;
		$.contributions[_campaignId][msg.sender] += weiAmount;

		// Add the campaign to the user's participated campaigns if this is their first contribution
		if ($.contributions[_campaignId][msg.sender] == weiAmount) {
			$.userCampaigns[msg.sender].add(_campaignId);
		}

		router.register(msg.sender, referrerId);

		emit ContributionMade(_campaignId, msg.sender, weiAmount);
	}

	/**
	 * @dev Withdraw funds after the campaign successfully meets its goal.
	 * @param _campaignId The ID of the campaign to withdraw funds from.
	 */
	function withdrawFunds(
		uint256 _campaignId
	)
		external
		campaignExists(_campaignId)
		onlyOwner
		hasMetGoal(_campaignId)
		hasNotWithdrawn(_campaignId)
		returns (uint256 amount)
	{
		MainStorage storage $ = _getMainStorage();

		Campaign storage campaign = $.campaigns[_campaignId];

		amount = campaign.fundsRaised;
		campaign.isWithdrawn = true;
		campaign.status = CampaignStatus.Success;

		// Remove the campaign from the set of all campaigns
		_removeCampaignFromActiveCampaigns(_campaignId);

		payable(owner()).transfer(amount);
		emit FundsWithdrawn(_campaignId, msg.sender, amount);
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

			uint256 unUsedContributions = gTokenBalance.amount;
			assert(
				contribution <= unUsedContributions &&
					unUsedContributions <= campaign.fundsRaised
			);

			userLiqShare = FullMath.mulDiv(
				contribution,
				gTokenBalance.attributes.lpDetails.liquidity,
				unUsedContributions
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
		_removeCampaignFromUserCampaigns(msg.sender, _campaignId);

		// Update the status to Failed
		campaign.status = CampaignStatus.Failed;

		payable(msg.sender).transfer(amount);

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

	receive() external payable {}
}
