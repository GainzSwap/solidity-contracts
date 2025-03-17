import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Gainz, GToken, Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ZeroAddress } from "ethers";
import { isAddressEqual } from "../../utilities";

export default async function completeCampaign(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("Completing Campaign");
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const launchPair = await ethers.getContractAt("LaunchPair", await governance.launchPair());

  const activeCampaigns = await launchPair.getActiveCampaigns().then(async ids =>
    Promise.all(
      ids.map(async campaignId => {
        const campaign = await launchPair.campaigns(campaignId);
        return { campaign, campaignId };
      }),
    ),
  );

  const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
  if (!block) {
    throw "Block not found";
  }
  const refund = async <C extends { fundsRaised: bigint; id: bigint; creator: string }>(c: C) => {
    const launchPairBal = await ethers.provider.getBalance(launchPair);
    if (launchPairBal < c.fundsRaised) {
      console.log("Refunding campaign", c.id);
      await hre.run("refund", { id: String(c.id) });

      console.log("Progressing campaign", c.id);
      const campaignCreator = await ethers.getSigner(c.creator);
      await governance.connect(campaignCreator).progressNewPairListing();
    }
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
