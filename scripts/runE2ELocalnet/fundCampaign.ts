import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Gainz, GToken, Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { minutes } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";
import { randomNumber } from "../../utilities";

export default async function fundCampaign(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\nFunding Campaign");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);

  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const launchPair = await ethers.getContractAt("LaunchPair", await governance.launchPair());

  const campaignIds = await launchPair.getActiveCampaigns();

  for (const campaignId of campaignIds) {
    const { goal, deadline } = await launchPair.getCampaignDetails(campaignId);
    if (deadline <= (await time.latest())) continue;

    for (const account of accounts) {
      try {
        const amount = await ethers.provider.getBalance(account.address).then(bal => {
          const randBal = Math.floor(Math.random() * +bal.toString());
          return BigInt(randBal) / 100_000n;
        });

        const referrerId = Math.floor(Math.random() * +(await router.totalUsers()).toString());
        await launchPair.connect(account).contribute(campaignId, referrerId, { value: amount });

        console.log(`${account.address} funded campaign ${campaignId}`);
      } catch (error) {
        console.log(error);
      }

      await time.increase(minutes(randomNumber(5, 50)));
    }
  }
}
