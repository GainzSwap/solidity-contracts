import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getRandomItem, runInErrorBoundry } from "../../utilities";

export default async function unStake(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\nunStaking");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const goveAddr = await ethers.getContractAt("WNTV", await router.getGovernance());
  const governance = await ethers.getContractAt("Governance", goveAddr);
  const gToken = await ethers.getContractAt("GToken", await governance.getGToken());

  for (const account of accounts) {
    console.log(`unStaking ${account.address}`);
    const [...nonces] = await gToken.getNonces(account);
    if (!nonces.length) return;

    await runInErrorBoundry(
      () => governance.connect(account).unStake(getRandomItem(nonces), 1n, 1n),
      ["No GToken balance found at nonce for user"],
    );
  }
}
