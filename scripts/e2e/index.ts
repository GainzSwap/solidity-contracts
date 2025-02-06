import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import swap from "./swap";
import stake from "./stake";
import { randomNumber, sleep } from "../../utilities";
import axios from "axios";
import fundCampaign from "./fundCampaign";
import claimRewards from "./claimRewards";
import delegate from "./delegate";
import unDelegate from "./unDelegate";

task("e2e", "").setAction(async (_, hre) => {
  const actions = [fundCampaign, delegate, unDelegate];
  const accounts = await hre.ethers.getSigners();

  while (true) {
    await Promise.all(
      actions.map(async action => {
        const accountStart = randomNumber(4, accounts.length / 2);
        const accountEnd = randomNumber(accountStart + 1, accounts.length);
        const selectedAccounts = accounts.slice(accountStart, accountEnd);

        try {
          await action(hre, selectedAccounts);
        } catch (error: any) {
          if (
            !["INSUFFICIENT_INPUT_AMOUNT", "ECONNRESET", "EADDRNOTAVAIL", "other side closed"].some(errString =>
              error.toString().includes(errString),
            )
          ) {
            throw error;
          }

          console.log(error);
        }

        await Promise.allSettled(
          selectedAccounts.map(account =>
            axios.get("http://localhost:3000/api/user/stats/" + account.address + "?chainId=31337"),
          ),
        );
      }),
    );
  }
});
