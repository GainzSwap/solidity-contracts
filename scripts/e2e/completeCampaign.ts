import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { isAddressEqual } from "../../utilities";
import { ZeroAddress } from "ethers";

export default async function completeCampaign(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("Completing Campaign");
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const launchPair = await ethers.getContractAt("LaunchPair", await governance.launchPair());

  const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
  if (!block) {
    throw "Block not found";
  }
  const refund = async <C extends { fundsRaised: bigint; id: bigint; creator: string }>(c: C) => {
    if (isAddressEqual(c.creator, ZeroAddress)) return;

    const { campaignId } = await launchPair.pairListing(c.creator);
    if (campaignId != c.id) return;

    console.log("Progressing campaign", c.id);
    const campaignCreator = await ethers.getSigner(c.creator);
    await launchPair.connect(campaignCreator).progressNewPairListing();
  };
  for (const account of accounts) {
    const userContributedCampaignIDs = await launchPair.getUserCampaigns(account);
    for (const id of userContributedCampaignIDs) {
      const { deadline, goal, fundsRaised, creator } = await launchPair.getCampaignDetails(id);
      if (deadline > block.timestamp) continue;

      await refund({ id, fundsRaised, creator });

      if (goal <= fundsRaised) {
        console.log(account.address, "Geting Campaign staked tokens", id);
        await launchPair.connect(account).withdrawLaunchPairToken(id);
      } else {
        console.log(account.address, "Geting Campaign refund", id);
        await launchPair.connect(account).getRefunded(id);
      }
    }
  }
}
