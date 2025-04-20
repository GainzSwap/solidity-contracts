import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { parseEther } from "ethers";
import { getAmount, randomNumber } from "../../utilities";

export default async function fundCampaign(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\nFunding Campaign");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const wNative = await router.getWrappedNativeToken();

  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const launchPair = await ethers.getContractAt("LaunchPair", await governance.launchPair());

  const campaignIds = await launchPair.getActiveCampaigns();
  const minContribution = parseEther("1");

  for (const campaignId of campaignIds) {
    const { deadline, creator, } = await launchPair.getCampaignDetails(campaignId);
    if (deadline <= (await time.latest())) continue;
    const { pairedToken } = await launchPair.pairListing(creator);

    for (const account of accounts) {
      const { amount, isNative } = await getAmount(account, pairedToken, hre.ethers, wNative).then(
        ({ amount, isNative, balance }) => {
          if (amount < minContribution) return { amount: minContribution > balance ? 0 : minContribution, isNative };

          return { amount, isNative };
        },
      );
      if (amount < minContribution) continue;

      const value = isNative ? amount : undefined;
      if (!value) {
        await (await ethers.getContractAt("ERC20", pairedToken)).connect(account).approve(launchPair , 2n ** 251n);
      }

      await launchPair.connect(account).contribute({ nonce: 0, amount, token: pairedToken }, campaignId, { value });

      console.log(`${account.address} funded campaign ${campaignId}`);
    }
  }
}
