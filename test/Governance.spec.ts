import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { claimRewardsFixture, routerFixture } from "./shared/fixtures";
import { expect } from "chai";
import { Addressable, AddressLike, parseEther, ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { days } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";

describe("Governance", function () {
  it("deploys governance", async () => {
    const { gToken } = await loadFixture(routerFixture);

    expect(await gToken.name()).to.eq("GainzSwap Governance Token");
  });

  describe("stake", function () {
    it("Should mint GToken with correct attributes", async function () {
      const {
        governance,
        gToken,
        users: [user],
        createPair,
      } = await loadFixture(routerFixture);

      const [{ token: tokenA }, { token: tokenB }] = await createPair();

      const epochsLocked = 1080;
      const stakeAmount = parseEther("0.05");

      const tokenBcontract = await ethers.getContractAt("TestERC20", tokenB as Addressable);
      await tokenBcontract.mintApprove(user, governance, stakeAmount);

      // Act for native coin staking

      await governance
        .connect(user)
        .stake({ token: tokenA, nonce: 0, amount: stakeAmount }, epochsLocked, [[tokenA], [tokenA, tokenB], []], 0, 0, {
          value: stakeAmount,
        });

      // Assert for native coin staking

      const { attributes: nativeStakingAttr } = await gToken.getBalanceAt(user, 1);

      expect(nativeStakingAttr.rewardPerShare).to.equal(0);
      expect(nativeStakingAttr.epochStaked).to.equal(0);
      expect(nativeStakingAttr.stakeWeight).to.gt(0);
      expect(nativeStakingAttr.epochsLocked).to.equal(epochsLocked);
      expect(nativeStakingAttr.lpDetails.liquidity).to.gt(0);
      expect(nativeStakingAttr.lpDetails.liqValue).to.gt(0);

      // Act for ERC20 staking

      await governance
        .connect(user)
        .stake({ token: tokenB, nonce: 0, amount: stakeAmount }, epochsLocked, [[tokenB], [tokenB, tokenA], []], 0, 0);

      // Assert for ERC20 staking

      const { attributes: erc20StakingAttr } = await gToken.getBalanceAt(user, 2);

      expect(erc20StakingAttr.rewardPerShare).to.equal(0);
      expect(erc20StakingAttr.epochStaked).to.equal(0);
      expect(erc20StakingAttr.stakeWeight).to.gt(0);
      expect(erc20StakingAttr.epochsLocked).to.equal(epochsLocked);
      expect(erc20StakingAttr.lpDetails.liquidity).to.gt(0);
      expect(erc20StakingAttr.lpDetails.liqValue).to.gt(0);
    });

    it("Should calculate liquidity value for tokenA with a 5-hop path to the native token", async () => {
      // Deploy tokens and initialize contracts
      const {
        governance,
        gToken,
        users: [user],
        wrappedNativeToken,
        createToken,
        createPair,
      } = await loadFixture(routerFixture);

      // Deploy tokenA, tokenB, and intermediary tokens
      const tokenA = await createToken(5);
      const tokenB = await createToken(9);
      const intermediate1 = await createToken(2);
      const intermediate2 = await createToken(3);
      const intermediate3 = await createToken(4);
      const intermediate4 = await createToken(5);

      // Create path to native token with 5 hops
      const pathToNative = [tokenA, intermediate1, intermediate2, intermediate3, intermediate4, wrappedNativeToken];

      // Create pairs to link to the path
      let pairsCreated = 0;
      for (const [[token1, amount1], [token2, amount2]] of [
        [
          [tokenA, parseEther("0.05")],
          [tokenB, parseEther("10")],
        ],
        [
          [tokenA, parseEther("0.05")],
          [intermediate1, parseEther("20")],
        ],
        [
          [intermediate1, parseEther("20")],
          [intermediate2, parseEther("30")],
        ],
        [
          [intermediate2, parseEther("30")],
          [intermediate3, parseEther("40")],
        ],
        [
          [intermediate3, parseEther("40")],
          [intermediate4, parseEther("50")],
        ],
        [
          [intermediate4, parseEther("50")],
          [ZeroAddress, parseEther("0.0009")],
        ],
      ] as [[AddressLike, bigint], [AddressLike, bigint]][]) {
        await createPair({
          paymentA: { token: token1, nonce: 0, amount: amount1 },
          paymentB: { token: token2, nonce: 0, amount: amount2 },
          pairsCreated: ++pairsCreated,
        });
      }

      // Approve and stake with the given path
      const payment = { token: wrappedNativeToken, amount: parseEther("0.0001"), nonce: 0 };

      const nativeToTokenAPath = pathToNative.slice().reverse();
      await governance.connect(user).stake(
        payment,
        1080, // Epochs locked
        [nativeToTokenAPath, [...nativeToTokenAPath, tokenB], pathToNative], // Paths for A, B, and to native
        0, // amountOutMinA
        0, // amountOutMinB
        { value: payment.amount },
      );

      // Fetch and assert native liquidity value
      const { attributes: gTokenAttributes } = await gToken.getBalanceAt(user, 1);
      expect(gTokenAttributes.lpDetails.liqValue).to.be.gt(0); // Liquidity value should be greater than zero
      expect(gTokenAttributes.epochsLocked).to.equal(1080); // Correct epochs locked
    });
  });

  describe("claimRewards", function () {
    it("Should allow a user to claim rewards if available", async function () {
      const {
        users: [user],
        governance,
        gainzToken,
        gToken,
        createPair,
      } = await loadFixture(routerFixture);
      const stakeAmount = parseEther("0.05");
      const epochsLocked = 1080;
      const nonce = 1; // assume staking gives us nonce 1

      // Setup: Mint and approve tokenB for staking
      const [{ token: tokenA }, { token: tokenB }] = await createPair();
      const tokenBcontract = await ethers.getContractAt("TestERC20", tokenB as Addressable);
      await tokenBcontract.mintApprove(user, governance, stakeAmount);

      // Stake to initiate rewards
      await governance
        .connect(user)
        .stake({ token: tokenB, nonce: 0, amount: stakeAmount }, epochsLocked, [[tokenB], [tokenB, tokenA], []], 0, 0);

      // Act: Claim rewards
      const userBalanceBefore = await gainzToken.balanceOf(user);
      await governance.connect(user).claimRewards(nonce);
      const userBalanceAfter = await gainzToken.balanceOf(user);

      // Assert: Rewards transferred
      expect(userBalanceAfter - userBalanceBefore).to.gt(0);
      expect((await gToken.getBalanceAt(user, nonce + 1)).attributes.rewardPerShare).to.eq(
        await governance.rewardPerShare(),
      );
    });

    it("Should damping rewards on frequent claiming", async function () {
      const {
        users: [, , , , user, user1, user2],
        governance,
        gainzToken,
        gToken,
        createPair,
      } = await loadFixture(routerFixture);
      const stakeAmount = parseEther("0.05");
      const epochsLocked = 1080;

      // Setup: Mint and approve tokenB for staking
      const [{ token: tokenA }, { token: tokenB }] = await createPair();
      const tokenBcontract = await ethers.getContractAt("TestERC20", tokenB as Addressable);

      // Stake to initiate rewards
      await tokenBcontract.mintApprove(user, governance, stakeAmount);
      await governance
        .connect(user)
        .stake({ token: tokenB, nonce: 0, amount: stakeAmount }, epochsLocked, [[tokenB], [tokenB, tokenA], []], 0, 0);

      await gToken.connect(user).split(1, [user, user1, user2], [0, 500, 500]);

      const checkBalance = async (type: "more" | "equal") => {
        const user1Bal = await gainzToken.balanceOf(user1);
        const user2Bal = await gainzToken.balanceOf(user2);

        if (type == "equal") {
          expect(user1Bal).to.eq(user2Bal);
        } else {
          expect(user2Bal).to.gt(user1Bal);
        }
      };

      // Act: Claim rewards
      await checkBalance("equal");
      let count = 0;
      while (count < 15) {
        await governance.connect(user1).claimRewards((await gToken.getNonces(user1))[0]);
        await time.increase(days(1));
        count++;
      }

      await governance.connect(user2).claimRewards((await gToken.getNonces(user2))[0]);
      await governance.connect(user1).claimRewards((await gToken.getNonces(user1))[0]);

      await checkBalance("more");
    });

    it("Should decrease the rewards reserve after claiming", async function () {
      const {
        users: [user],
        governance,
        gainzToken,
        createPair,
      } = await loadFixture(routerFixture);
      const stakeAmount = parseEther("0.05");
      const epochsLocked = 1080;
      const nonce = 1;
      const rewardAmount = parseEther("0.02");

      // Setup: Mint and approve tokenB for staking
      const [{ token: tokenA }, { token: tokenB }] = await createPair();
      const tokenBcontract = await ethers.getContractAt("TestERC20", tokenB as Addressable);
      await tokenBcontract.mintApprove(user, governance, stakeAmount);

      // Stake to initiate rewards
      await governance
        .connect(user)
        .stake({ token: tokenB, nonce: 0, amount: stakeAmount }, epochsLocked, [[tokenB], [tokenB, tokenA], []], 0, 0);

      // Add rewards to the reserve
      await gainzToken.mint(governance, rewardAmount);
      await governance.updateRewardReserve();

      // Capture the initial rewards reserve
      const reserveBefore = await governance.rewardsReserve();

      // Act: Claim rewards
      await governance.connect(user).claimRewards(nonce);

      // Assert: Rewards reserve is reduced correctly
      const reserveAfter = await governance.rewardsReserve();
      expect(reserveBefore - reserveAfter).to.equal(rewardAmount - 1n);
    });
  });

  describe("unStake", function () {
    async function unStakeFixture() {
      const amountToStake = parseEther("100");
      // Deploy the Governance contract and required tokens
      const {
        governance,
        owner,
        gToken,
        users: [user],
        ...fixture
      } = await routerFixture();

      const [{ token: tokenA }, paymentB, pairAddress] = await fixture.createPair();

      const stakeToken = await ethers.getContractAt("TestERC20", paymentB.token as Addressable);

      // Mint and stake tokens for user
      await stakeToken.mintApprove(user, governance, amountToStake);
      await governance
        .connect(user)
        .stake(
          { ...paymentB, amount: amountToStake },
          1080,
          [[paymentB.token], [paymentB.token, tokenA], [paymentB.token, tokenA]],
          0,
          0,
        );

      // Get the initial nonce used for staking
      const userNonces = await gToken.getNonces(user);
      const nonExistentNonce = userNonces.at(-1)! + 1n; // For testing invalid nonce

      return {
        token: await ethers.getContractAt("TestERC20", paymentB.token as Addressable),
        userNonces,
        nonExistentNonce,
        governance,
        gToken,
        user,
        amountToStake,
        owner,
        pairAddress,
        ...fixture,
      };
    }

    it("should successfully unstake and transfer rewards when available", async function () {
      const { gainzToken, governance, amountToStake, user, gToken, token, pairAddress } =
        await loadFixture(unStakeFixture);
      // Simulate reward accumulation
      await gainzToken.mint(governance, amountToStake);
      await governance.updateRewardReserve();

      const userInitialBalance = await gainzToken.balanceOf(user.address);
      const governanceInitialReserve = await governance.rewardsReserve();
      const userInitialTokenBalance = await token.balanceOf(user);

      // Unstake with minimum amounts set to 0
      await governance.connect(user).unStake((await gToken.getNonces(user))[0], 1, 1);
      const userFinalBalance = await gainzToken.balanceOf(user.address);
      const governanceFinalReserve = await governance.rewardsReserve();
      const userFinalTokenBalance = await token.balanceOf(user);

      // Check that rewards were transferred to the user
      expect(userFinalTokenBalance).to.be.gt(userInitialTokenBalance);
      expect(userFinalBalance).to.be.gt(userInitialBalance);
      expect(governanceFinalReserve).to.be.lt(governanceInitialReserve);

      expect(await gToken.totalStakeWeight()).to.eq(0);
      expect(await gToken.totalSupply()).to.eq(0);
      expect(await gToken.pairSupply(pairAddress)).to.eq(0);
    });

    it("should revert if trying to unstake with a non-existent nonce", async function () {
      const { nonExistentNonce, governance, user } = await loadFixture(unStakeFixture);
      await expect(governance.connect(user).unStake(nonExistentNonce, 0, 0)).to.be.revertedWith(
        "No GToken balance found at nonce for user",
      );
    });

    // it("should correctly adjust user attributes after unstaking", async function () {
    //   const initialAttributes = await governance.getUserAttributes(user.address, 0);

    //   // Unstake without minimum amounts
    //   await governance.connect(user).unstake( 0, 0);

    //   const finalAttributes = await governance.getUserAttributes(user.address, 0);

    //   // Check that the liquidity in user attributes is now zero
    //   expect(finalAttributes.gTokenDetails.liquidity).to.equal(0);
    // });

    // it("should burn the GToken upon unstaking", async function () {
    //   // Unstake to trigger GToken burn
    //   await governance.connect(user).unstake( 0, 0);

    //   // Check that GToken balance for the user is zero
    //   const gTokenBalance = await governance.getGTokenBalance(user.address, 0);
    //   expect(gTokenBalance).to.equal(0);
    // });

    // it("should correctly handle cases where claimable reward is zero", async function () {
    //   // Attempt to unstake when there are no rewards to claim
    //   const userInitialBalance = await gainzToken.balanceOf(user.address);

    //   await governance.connect(user).unstake( 0, 0);

    //   const userFinalBalance = await gainzToken.balanceOf(user.address);
    //   expect(userFinalBalance).to.equal(userInitialBalance);
    // });

    // it("should revert if minimum amount conditions are not met", async function () {
    //   // Set high minimum amounts that should not be met
    //   const amount0Min = ethers.utils.parseEther("200");
    //   const amount1Min = ethers.utils.parseEther("200");

    //   await expect(governance.connect(user).unstake( amount0Min, amount1Min)).to.be.revertedWith("SlippageExceeded");
    // });
  });

  async function proposeNewPairListingFixture() {
    const {
      owner,
      governance,
      gToken,
      users: [pairOwner, ...otherUsers],
      gainzNativePair,
      stake,
      ...fixtures
    } = await claimRewardsFixture();

    const proposeNewPairListing = async () => {
      const tradeToken = await ethers.deployContract("TestERC20", ["NewPairTrade", "TRKJ", 18], { signer: pairOwner });

      const tradeTokenPayment = {
        token: tradeToken,
        amount: parseEther("123455"),
        nonce: 0,
      };
      // Approve the listing fee payment
      await tradeToken.mint(pairOwner, tradeTokenPayment.amount);
      await tradeToken.connect(pairOwner).approve(governance, tradeTokenPayment.amount);

      // Enter governance to create GToken balance
      const gTokenBalance = (
        await stake(pairOwner, { amount: { nativeAmount: parseEther("6000") }, epochsLocked: 1080 })
      ).at(-1)!;
      const securityGTokenPayment = {
        token: gToken,
        amount: gTokenBalance.amount,
        nonce: gTokenBalance.nonce,
      };
      await gToken.connect(pairOwner).setApprovalForAll(governance, true);

      // Propose new pair listing
      await governance.connect(pairOwner).proposeNewPairListing(securityGTokenPayment, tradeTokenPayment);

      // Validate that the listing was proposed correctly
      const activeListing = await governance.pairListing(pairOwner);
      expect(activeListing.owner).to.equal(pairOwner);
      expect(activeListing.tradeTokenPayment.token).to.equal(await tradeToken.getAddress());
      expect(activeListing.securityGTokenPayment.nonce).to.equal(securityGTokenPayment.nonce);
      expect(activeListing.campaignId).to.gt(0);

      return tradeToken;
    };

    const newTradeToken = await proposeNewPairListing();
    return {
      ...fixtures,
      governance,
      gToken,
      otherUsers,
      pairOwner,
      newTradeToken,
      stake,
    };
  }

  describe("progressNewPairListing", function () {
    it("Should revert if no listing is found for the sender", async function () {
      const {
        governance,
        otherUsers: [someUser],
        epochLength,
      } = await loadFixture(proposeNewPairListingFixture);
      await time.increase(epochLength * 8n);

      await expect(governance.connect(someUser).progressNewPairListing()).to.be.revertedWith("No listing found");
    });

    it("Should return security deposit if proposal does not pass", async function () {
      const { governance, gToken, epochLength, pairOwner, launchPairContract } =
        await loadFixture(proposeNewPairListingFixture);
      const duration = epochLength * 8n;
      await launchPairContract.connect(pairOwner).startCampaign(50n, duration, 1);

      await time.increase(duration + 1n);
      const expectedSecurityGTokenPayment = (await governance.pairListing(pairOwner)).securityGTokenPayment;
      await governance.connect(pairOwner).progressNewPairListing();

      expect((await governance.pairListing(pairOwner)).owner).to.be.eq(ZeroAddress);
      expect(await gToken.hasSFT(pairOwner, expectedSecurityGTokenPayment.nonce)).to.be.eq(
        true,
        "Security deposit must be returned",
      );
    });

    it("Should proceed to the next stage if proposal passes", async function () {
      const { governance, epochLength, pairOwner, launchPairContract } =
        await loadFixture(proposeNewPairListingFixture);

      await time.increase(epochLength * 8n);

      const { campaignId } = await governance.pairListing(pairOwner);
      expect(campaignId).to.be.gt(0);
      expect((await launchPairContract.campaigns(campaignId)).creator).to.be.equal(pairOwner.address);
    });

    it("Should fail the listing if the campaign is unsuccessful", async function () {
      const { governance, gToken, epochLength, pairOwner, launchPairContract } =
        await loadFixture(proposeNewPairListingFixture);

      await time.increase(epochLength * 8n);

      const { campaignId, securityGTokenPayment } = await governance.pairListing(pairOwner);
      expect(campaignId).to.be.gt(0);
      await launchPairContract.connect(pairOwner).startCampaign(parseEther("0.34434"), 34, campaignId);
      await time.increase(4774);

      await governance.connect(pairOwner).progressNewPairListing();

      await expect(governance.connect(pairOwner).progressNewPairListing()).to.be.revertedWith("No listing found");

      expect((await governance.pairListing(pairOwner)).owner).to.be.eq(ZeroAddress);
      expect(await gToken.hasSFT(pairOwner, securityGTokenPayment.nonce)).to.be.eq(
        true,
        "Security deposit must be returned",
      );
    });

    it("Should fail if trying to progress when funds are not withdrawn", async function () {
      const { governance, epochLength, pairOwner } = await loadFixture(proposeNewPairListingFixture);

      await time.increase(epochLength * 8n);

      const { campaignId } = await governance.pairListing(pairOwner);
      expect(campaignId).to.be.gt(0);

      await expect(governance.connect(pairOwner).progressNewPairListing()).to.be.revertedWith(
        "Governance: Funding not complete",
      );
    });

    it("Should add liquidity and distribute GToken if the campaign is successful", async function () {
      const {
        governance,
        gToken,
        otherUsers: [lpHaunter1, lpHaunter2],
        epochLength,
        pairOwner,
        launchPairContract,
      } = await loadFixture(proposeNewPairListingFixture);
      // Create EDU Pair
      // await router.createPair({ token: ZeroAddress, amount: 0, nonce: 0 }, { value: parseEther("0.93645") });

      await time.increase(epochLength * 8n);

      const { campaignId, securityGTokenPayment } = await governance.pairListing(pairOwner);
      expect(campaignId).to.be.gt(0);
      await launchPairContract.connect(pairOwner).startCampaign(parseEther((49_000_000).toString()), 3600, campaignId);
      const campaign = await launchPairContract.campaigns(campaignId);

      await launchPairContract.connect(lpHaunter1).contribute(campaignId, { value: parseEther("150") });
      await launchPairContract.connect(lpHaunter2).contribute(campaignId, { value: campaign.goal });

      await time.increase(30 * 3600);

      // This will create locked GToken
      await governance.connect(pairOwner).progressNewPairListing();
      expect(
        (await gToken.getGTokenBalance(pairOwner)).find(token => token.nonce == securityGTokenPayment.nonce)?.nonce,
      ).to.eq(securityGTokenPayment.nonce, "Security GToken should be returned back to pair owner");

      const campaignInitalGtoken = await gToken.getBalanceAt(
        launchPairContract,
        (await launchPairContract.getCampaignDetails(campaignId)).gtokenNonce,
      );
      expect((await gToken.getNonces(lpHaunter1)).length + (await gToken.getNonces(lpHaunter2)).length).to.eq(0);
      await launchPairContract.connect(lpHaunter1).withdrawLaunchPairToken(campaignId);
      await launchPairContract.connect(lpHaunter2).withdrawLaunchPairToken(campaignId);

      const withdrawnGTokenAmounts = (
        await Promise.all(
          [lpHaunter1, lpHaunter2].map(async hunter =>
            (await gToken.getGTokenBalance(hunter)).reduce((totalBal, bal) => totalBal + bal.amount, 0n),
          ),
        )
      ).reduce((sum, amt) => sum + amt);

      expect(Number(withdrawnGTokenAmounts)).to.eq(Number(campaignInitalGtoken.amount));
    });
  });
});
