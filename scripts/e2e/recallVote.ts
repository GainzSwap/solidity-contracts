import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Gainz, GToken, Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ZeroAddress } from "ethers";

let isRunning = false;

export default async function recallVote(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  if (isRunning) {
    console.log("Skipping  Recalling Vote", { isRunning });
    return;
  } else {
    isRunning = true;
  }
  console.log("\n Recalling Vote");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());

  for (const account of accounts) {
    try {
      if ((await governance.userVote(account)) != ZeroAddress) {
        await governance.connect(account).recallVoteToken();
      }
    } catch (error) {
      console.log(error);
    }
  }

  isRunning = false;
}
