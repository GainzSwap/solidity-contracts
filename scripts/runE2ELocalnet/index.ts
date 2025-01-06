import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import swap from "./swap";
import stake from "./stake";
import { randomNumber, sleep } from "../../utilities";
import axios from "axios";
import vote from "./vote";
import fundCampaign from "./fundCampaign";
import recallVote from "./recallVote";
import claimRewards from "./claimRewards";

task("runE2ELocalnet", "").setAction(async (_, hre) => {
  const actions = [fundCampaign, stake, vote, swap, recallVote, claimRewards];
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

    await sleep(randomNumber(800, 3_000));
  }
});
