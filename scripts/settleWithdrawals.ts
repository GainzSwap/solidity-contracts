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

  const WEDU = "0xd02E8c38a8E3db71f8b2ae30B8186d7874934e12";
  const wedu = await ethers.getContractAt("WNTV", WEDU);
  // {
  //   const reBalancePoolEDUAmt = await wNative.balanceOf(deployer);
  //   if (reBalancePoolEDUAmt <= 0n) return;

  //   await wNative.transfer(feeTo, reBalancePoolEDUAmt);

  //   // await wedu.connect(feeTo).withdraw(reBalancePoolEDUAmt);

  //   const { hash } = await feeTo.sendTransaction({
  //     value: reBalancePoolEDUAmt,
  //     to: "0x8D0739d9D0d49aFCF8d101416cD2759Bf8922013",
  //   });

  //   console.log("reBalancePoolEDUAmt hash", hash);

  //   return;
  // }

  {
    const pendingWithdrawal = (await wNative.pendingWithdrawals()) - (await ethers.provider.getBalance(wNative));
    const balance = await ethers.provider.getBalance(feeTo);
    console.log({ pendingWithdrawal: formatEther(pendingWithdrawal) });
    if (pendingWithdrawal > 0n) {
      if (balance < pendingWithdrawal) {
        await wedu.connect(feeTo).withdraw(pendingWithdrawal);
      }
      await wNative.connect(feeTo).settleWithdrawals({ value: pendingWithdrawal });
    }
  }
  {
    const balance = await ethers.provider.getBalance(feeTo);
    const amountToStake = balance - parseEther("9.1");
    if (amountToStake > 0n) {
      const tx = await feeTo.sendTransaction({
        value: amountToStake,
        to: WEDU,
      });
      console.log("Stake hash", tx.hash);
    }
  }

  const treasuryBalanceDelta =
    (await wedu.balanceOf("0x68Fe50235230e24f17c90f8Fb0Cd4626fbD34972")) - (await wNative.totalSupply());
  console.log("treasuryBalanceDelta", formatEther(treasuryBalanceDelta));
});
