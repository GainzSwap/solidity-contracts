import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("LaunchPair", function () {
  async function deployLaunchPairFixture() {
    const [owner, creator, contributor1, contributor2, ...otherUsers] = await ethers.getSigners();

    // Deploy the GToken contract
    const GTokenFactory = await ethers.getContractFactory("GToken");
    const gToken = await GTokenFactory.deploy();
    await gToken.waitForDeployment();

    // Deploy the LaunchPair contract
    const LaunchPairFactory = await ethers.getContractFactory("LaunchPair");
    const launchPair = await LaunchPairFactory.deploy();
    await launchPair.initialize(gToken);
    await launchPair.waitForDeployment();

    return { owner, creator, contributor1, contributor2, gToken, launchPair, otherUsers };
  }

  describe("createCampaign", function () {
    it("Should allow the owner to create a campaign", async function () {
      const { launchPair, creator } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);

      const campaign = await launchPair.getCampaignDetails(1);
      expect(campaign.creator).to.equal(creator.address);
    });

    it("Should revert if a non-owner tries to create a campaign", async function () {
      const { launchPair, contributor1 } = await loadFixture(deployLaunchPairFixture);

      await expect(launchPair.connect(contributor1).createCampaign(contributor1.address)).to.be.revertedWithCustomError(
        launchPair,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("startCampaign", function () {
    it("Should allow the creator to start a campaign", async function () {
      const { launchPair, creator } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);

      const goal = ethers.parseEther("10");
      const duration = 3600; // 1 hour

      await launchPair.connect(creator).startCampaign(goal, duration, 1);

      const campaign = await launchPair.getCampaignDetails(1);
      expect(campaign.goal).to.equal(goal);
      expect(campaign.status).to.equal(1); // Funding status
    });

    it("Should revert if a non-creator tries to start the campaign", async function () {
      const { launchPair, creator, contributor1 } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);

      const goal = ethers.parseEther("10");
      const duration = 3600; // 1 hour

      await expect(launchPair.connect(contributor1).startCampaign(goal, duration, 1)).to.be.revertedWith(
        "Not campaign creator",
      );
    });

    it("Should revert if the goal or duration is invalid", async function () {
      const { launchPair, creator } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);

      await expect(launchPair.connect(creator).startCampaign(0, 3600, 1)).to.be.revertedWith("Invalid input");

      await expect(launchPair.connect(creator).startCampaign(ethers.parseEther("100000"), 0, 1)).to.be.revertedWith(
        "Invalid input",
      );
    });
  });

  describe("contribute", function () {
    it("Should allow contributions to a funding campaign", async function () {
      const { launchPair, creator, contributor1, contributor2 } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);
      await launchPair.connect(creator).startCampaign(ethers.parseEther("100000"), 3600, 1);

      await launchPair.connect(contributor1).contribute(1, { value: ethers.parseEther("200") });

      await launchPair.connect(contributor2).contribute(1, { value: ethers.parseEther("300") });

      const campaign = await launchPair.getCampaignDetails(1);
      expect(campaign.fundsRaised).to.equal(ethers.parseEther("500"));

      const contribution1 = await launchPair.contributions(1, contributor1.address);
      expect(contribution1).to.equal(ethers.parseEther("200"));

      const contribution2 = await launchPair.contributions(1, contributor2.address);
      expect(contribution2).to.equal(ethers.parseEther("300"));
    });

    it("Should revert if the contribution is low", async function () {
      const { launchPair, creator, contributor1 } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);
      await launchPair.connect(creator).startCampaign(ethers.parseEther("100000"), 3600, 1);

      await expect(launchPair.connect(contributor1).contribute(1, { value: 10 })).to.be.revertedWith(
        "Minimum contribution is 150",
      );
    });

    it("Should revert if the campaign is expired", async function () {
      const { launchPair, creator, contributor1 } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);
      await launchPair.connect(creator).startCampaign(ethers.parseEther("100000"), 1, 1);

      await time.increase(2);

      await expect(
        launchPair.connect(contributor1).contribute(1, { value: ethers.parseEther("1") }),
      ).to.be.revertedWith("Campaign expired");
    });
  });

  describe("withdrawFunds", function () {
    it("Should allow the owner to withdraw funds after a successful campaign", async function () {
      const { launchPair, creator, contributor1, contributor2, owner } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);
      await launchPair.connect(creator).startCampaign(ethers.parseEther("1000"), 3600, 1);

      await launchPair.connect(contributor1).contribute(1, { value: ethers.parseEther("500") });
      await launchPair.connect(contributor2).contribute(1, { value: ethers.parseEther("500") });

      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

      await launchPair.withdrawFunds(1);
      const campaign = await launchPair.getCampaignDetails(1);

      expect(campaign.fundsRaised).to.equal(ethers.parseEther("1000"));
      expect(campaign.status).to.equal(3); // Success status

      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.approximately(
        ethers.parseEther("1000"),
        ethers.parseEther("0.0001"),
        "Balance should be this value, but since gas fees have to be paid, it some what is not exact",
      );
    });

    it("Should revert if the campaign goal is not met", async function () {
      const { launchPair, creator, contributor1 } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);
      await launchPair.connect(creator).startCampaign(ethers.parseEther("10000"), 3600, 1);

      await launchPair.connect(contributor1).contribute(1, { value: ethers.parseEther("150") });

      await expect(launchPair.withdrawFunds(1)).to.be.revertedWith("Goal not met");
    });

    it("Should revert if the funds have already been withdrawn", async function () {
      const { launchPair, creator, contributor1, contributor2 } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);
      await launchPair.connect(creator).startCampaign(ethers.parseEther("1000"), 3600, 1);

      await launchPair.connect(contributor1).contribute(1, { value: ethers.parseEther("500") });
      await launchPair.connect(contributor2).contribute(1, { value: ethers.parseEther("500") });

      await launchPair.withdrawFunds(1);

      await expect(launchPair.withdrawFunds(1)).to.be.revertedWith("Funds already withdrawn");
    });
  });

  describe("getRefunded", function () {
    it("Should allow a participant to get refunded after a failed campaign", async function () {
      const { launchPair, creator, contributor1 } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);
      await launchPair.connect(creator).startCampaign(ethers.parseEther("100000"), 3600, 1);

      await launchPair.connect(contributor1).contribute(1, { value: ethers.parseEther("200") });

      // Simulate campaign failure by advancing time past the deadline
      await time.increase(3601);

      await launchPair.connect(contributor1).getRefunded(1);

      const refund = await launchPair.contributions(1, contributor1.address);
      expect(refund).to.equal(0);
    });

    it("Should revert if the campaign is successful", async function () {
      const { launchPair, creator, contributor1, contributor2 } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);
      await launchPair.connect(creator).startCampaign(ethers.parseEther("100000"), 3600, 1);

      await launchPair.connect(contributor1).contribute(1, { value: ethers.parseEther("500") });
      await launchPair.connect(contributor2).contribute(1, { value: ethers.parseEther("500") });

      await expect(launchPair.connect(contributor1).getRefunded(1)).to.be.revertedWith("Refund not available");
    });

    it("Should revert if the user did not contribute to the campaign", async function () {
      const { launchPair, creator, contributor1, contributor2 } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);
      await launchPair.connect(creator).startCampaign(ethers.parseEther("100000"), 3600, 1);

      await launchPair.connect(contributor1).contribute(1, { value: ethers.parseEther("500") });

      // Simulate campaign failure by advancing time past the deadline
      await time.increase(3601);

      await expect(launchPair.connect(contributor2).getRefunded(1)).to.be.revertedWith(
        "Not a participant of selected campaign",
      );
    });
  });

  describe("View functionalities", function () {
    it("Should allow viewing all campaigns", async function () {
      const { launchPair, creator } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);
      await launchPair.createCampaign(creator.address);

      const campaigns = await Promise.all([1, 2].map(id => launchPair.campaigns(id)));

      expect(campaigns.length).to.equal(2);
      expect(campaigns[0].creator).to.equal(creator.address);
      expect(campaigns[1].creator).to.equal(creator.address);
    });

    it("Should allow viewing user-participated campaigns", async function () {
      const { launchPair, creator, contributor1 } = await loadFixture(deployLaunchPairFixture);

      await launchPair.createCampaign(creator.address);
      await launchPair.connect(creator).startCampaign(ethers.parseEther("100000"), 3600, 1);
      await launchPair.connect(contributor1).contribute(1, { value: ethers.parseEther("200") });

      const campaigns = await Promise.all((await launchPair.getActiveCampaigns()).map(id => launchPair.campaigns(id)));

      expect(campaigns.length).to.equal(1);
      expect(campaigns[0].creator).to.equal(creator.address);
    });
  });
});
