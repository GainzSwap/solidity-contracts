import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Gainz, Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export default async function unDelegate(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\nUn Delegating");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const wnative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());

  for (const account of accounts) {
    const amount = await wnative.balanceOf(account.address).then(bal => {
      const randBal = Math.floor(Math.random() * +bal.toString());
      return BigInt(randBal) / 10_000n;
    });

    console.log(`Un Delegating ${ethers.formatEther(amount)}`);

    try {
      await wnative.connect(account).withdraw(amount);
    } catch (error) {
      console.error(error);
    }
  }
}
