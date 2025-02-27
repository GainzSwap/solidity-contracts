import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { formatEther, parseEther } from "ethers";

task("settleWithdrawals").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer, newFeeTo } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const wNative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());

  const feeTo = await ethers.getSigner(newFeeTo);

  {
    const pendingWithdrawal = await wNative.pendingWithdrawals();
    const balance = await ethers.provider.getBalance(feeTo);
    console.log({ pendingWithdrawal: formatEther(pendingWithdrawal) });
    if (pendingWithdrawal > 0n) {
      if (balance < pendingWithdrawal) throw new Error("Insufficient Balance For settleWithdrawals");
      await wNative.connect(feeTo).settleWithdrawals({ value: pendingWithdrawal });
    }
  }
  {
    const balance = await ethers.provider.getBalance(feeTo);
    const amountToStake = balance - parseEther("9.1");
    if (amountToStake > 0n) {
      const tx = await feeTo.sendTransaction({
        value: amountToStake,
        to: "0xd02E8c38a8E3db71f8b2ae30B8186d7874934e12",
      });
      console.log("Stake hash",tx.hash);
    }
  }
});
