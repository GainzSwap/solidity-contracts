import { HardhatRuntimeEnvironment } from "hardhat/types";
import { GToken, Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getRandomItem } from "../../utilities";

export default async function claimRewards(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\nClaim Rewards");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);

  const gToken = await ethers.getContract<GToken>("GToken", deployer);

  const governance = await ethers.getContractAt("Governance", await router.getGovernance());

  for (const account of accounts) {
    const [...nonces] = await gToken.getNonces(account);
    if (!nonces.length) continue;

    try {
      await governance.connect(account).claimRewards(nonces);
    } catch (error: any) {
      if (!["No GToken balance found at nonce for user"].some(errString => error.toString().includes(errString)))
        throw error;
    }
  }
}
