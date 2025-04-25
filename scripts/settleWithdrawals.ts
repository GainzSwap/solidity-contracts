import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { formatEther, parseEther } from "ethers";
import axios from "axios";
import { sleep } from "../utilities";

task("settleWithdrawals")
  .addFlag("watch", "Watch the contract for pending withdrawals")
  .setAction(async ({ watch }, hre) => {
    const { ethers } = hre;
    const indexerApi = process.env.INDEXER_API;
    if (!indexerApi) {
      throw new Error("No indexer api");
    }

    const { deployer, newFeeTo } = await hre.getNamedAccounts();
    const router = await ethers.getContract<Router>("Router", deployer);
    const wNative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());

    const feeTo = await ethers.getSigner(newFeeTo);

    const WEDU = "0xd02E8c38a8E3db71f8b2ae30B8186d7874934e12";
    const wedu = await ethers.getContractAt("WNTV", WEDU);

    while (true) {
      {
        const caBal = await ethers.provider.getBalance(wNative);
        const pendingWithdrawal = await wNative.pendingWithdrawals();
        const pendingWithdrawalTimeRange = await axios
          .get(indexerApi + "/withdrawals/pending?within=3600")
          .then(({ data }) => BigInt(data.timeRangePendingAmount));
        const balance = await ethers.provider.getBalance(feeTo);

        const delta =
          pendingWithdrawal > pendingWithdrawalTimeRange
            ? pendingWithdrawalTimeRange - pendingWithdrawal
            : pendingWithdrawal;

        console.log({
          pendingWithdrawal: formatEther(pendingWithdrawal),
          pendingWithdrawalTimeRange: formatEther(pendingWithdrawalTimeRange),
          caBal: formatEther(caBal),
          delta: formatEther(delta),
        });
        if (delta > 0n) {
          if (balance < delta) {
            console.log("Not enough balance to withdraw, requesting for more");
            await wedu.connect(feeTo).withdraw(delta);
          }
          console.log(
            "settleWithdrawals hash",
            (await wNative.connect(feeTo).settleWithdrawals({ value: delta })).hash,
          );
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

      if (!Boolean(watch)) {
        break;
      }

      console.log("Waiting for 10 minutes");
      await sleep(1000 * 60 * 10); // 10 minutes
    }
  });
