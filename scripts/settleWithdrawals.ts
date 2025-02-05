import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";

task("settleWithdrawals").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const wNative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());

  const value = await wNative.pendingWithdrawals();
  const balance = await ethers.provider.getBalance(deployer);

  if (balance < value) throw new Error("Insufficient Balance");

  await wNative.settleWithdrawals({ value });
});
