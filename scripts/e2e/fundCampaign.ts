import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { parseEther } from "ethers";
import { randomNumber } from "../../utilities";

export default async function fundCampaign(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\nFunding Campaign");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);

  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const launchPair = await ethers.getContractAt("LaunchPair", await governance.launchPair());

  const campaignIds = await launchPair.getActiveCampaigns();
  const minContribution = parseEther("1");

  for (const campaignId of campaignIds) {
    const { deadline } = await launchPair.getCampaignDetails(campaignId);
    if (deadline <= (await time.latest())) continue;

    for (const account of accounts) {
      const amount = await ethers.provider.getBalance(account.address).then(bal => {
        if (bal < minContribution) return 0n;

        const amount = BigInt(randomNumber(50e18, Number(minContribution)).toFixed());
        return bal < amount ? minContribution : amount;
      });
      if (amount < minContribution) continue;

      const totalUsers = +(await router.totalUsers()).toString();
      const referrerId = [0, 1, 2, 3, 4, 5][(totalUsers + 1) % 3];
      await launchPair.connect(account).contribute(campaignId, referrerId, { value: amount });

      console.log(`${account.address} funded campaign ${campaignId}`);
    }
  }
}
