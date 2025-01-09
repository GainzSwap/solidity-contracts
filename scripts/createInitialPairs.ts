import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router } from "../typechain-types";
import { parseEther, ZeroAddress } from "ethers";
import { days } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";

task("createInitialPairs", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const gainzAddress = await gainz.getAddress();

  const governanceAddress = await router.getGovernance();
  const governance = await ethers.getContractAt("Governance", governanceAddress);

  const wNativeToken = await router.getWrappedNativeToken();

  console.log("\nLaunching Pair", { gainzAddress, wNativeToken }, "\n\n");

  const lpAmount = (await gainz.balanceOf(deployer)) - parseEther("2,100,000".replace(/,/g, ""));
  const goal = parseEther("768,150.1".replace(/,/g, ""));

  await gainz.approve(governance, lpAmount);

  await governance.proposeNewPairListing(
    { nonce: 0, amount: 0, token: ZeroAddress },
    { nonce: 0, amount: lpAmount, token: gainz },
  );

  const launchPairAddress = await governance.launchPair();
  const launchPair = await ethers.getContractAt("LaunchPair", launchPairAddress);

  const { campaignId } = await governance.pairListing(deployer);

  await launchPair.startCampaign(goal, days(30), campaignId);
});
