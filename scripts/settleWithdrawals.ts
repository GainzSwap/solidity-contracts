import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { formatEther } from "ethers";

task("settleWithdrawals").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer, newFeeTo } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const wNative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());

  const feeTo = await ethers.getSigner(newFeeTo);

  const value = await wNative.pendingWithdrawals();
  const balance = await ethers.provider.getBalance(feeTo);

  console.log({ pendingWithdrawal: formatEther(value) });
  if (value == 0n) return console.log("Nothing to withdraw");

  if (balance < value) throw new Error("Insufficient Balance");

  await wNative.connect(feeTo).settleWithdrawals({ value });
});
