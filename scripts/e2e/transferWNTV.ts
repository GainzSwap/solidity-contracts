import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Gainz, Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { randomNumber } from "../../utilities";
import { time } from "@nomicfoundation/hardhat-network-helpers";

export default async function transferWNTV(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\ntransferWNTV");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const wnative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());

  for (const account of accounts) {
    const amount = await wnative.balanceOf(account.address).then(bal => {
      const randBal = Math.floor(Math.random() * +bal.toString());
      return BigInt(randBal) / 10_000n;
    });

    console.log(`transferWNTV ${ethers.formatEther(amount)}`);

    const accounts = await hre.getUnnamedAccounts();

    try {
      await wnative.connect(account).transfer(accounts[randomNumber(0, accounts.length)], amount);
    } catch (error) {
      console.error(error);
    }
  }
}
