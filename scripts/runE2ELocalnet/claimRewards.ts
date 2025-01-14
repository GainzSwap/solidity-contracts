import { HardhatRuntimeEnvironment } from "hardhat/types";
import { GToken, Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export default async function claimRewards(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\nClaim Rewards");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);

  const gToken = await ethers.getContract<GToken>("GToken", deployer);

  const governance = await ethers.getContractAt("Governance", await router.getGovernance());

  for (const account of accounts) {
    try {
      const gTokens = await gToken.getGTokenBalance(account);
      for (const { nonce } of gTokens) {
        await governance.connect(account).claimRewards(nonce);
      }
    } catch (error) {
      console.log(error);
    }
  }
}
