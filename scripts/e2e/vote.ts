import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Gainz, GToken, Router } from "../../typechain-types";
import { randomNumber } from "../../utilities";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { minutes } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";

let isRunning = false;

export default async function vote(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  if (isRunning) {
    console.log("Skipping Voting", { isRunning });
    return;
  } else {
    isRunning = true;
  }
  console.log("\nVoting");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);

  const gToken = await ethers.getContract<GToken>("GToken", deployer);
  const gTokenAddress = await gToken.getAddress();

  const governance = await ethers.getContractAt("Governance", await router.getGovernance());

  const { endEpoch, campaignId, tradeTokenPayment } = await governance.activeListing();
  const currentEpoch = await governance.currentEpoch();

  if (currentEpoch <= endEpoch) {
    for (const account of accounts) {
      try {
        const gTokens = await gToken.getGTokenBalance(account);
        for (const {
          amount,
          nonce,
          attributes: { epochsLocked },
        } of gTokens) {
          if (epochsLocked - currentEpoch < 360) continue;

          const shouldList = randomNumber(0, 100) <= 70;

          await gToken.connect(account).setApprovalForAll(governance, true);
          await governance
            .connect(account)
            .vote({ amount, nonce, token: gTokenAddress }, tradeTokenPayment.token, shouldList);

          console.log(`${account.address} voted ${shouldList ? "YES" : "NO"} for ${tradeTokenPayment.token}`);
        }
      } catch (error) {
        console.log(error);
      }
      await time.increase(minutes(5));
    }
  }

  isRunning = false;
}
