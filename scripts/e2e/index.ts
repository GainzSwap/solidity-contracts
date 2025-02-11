import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import swap from "./swap";
import stake from "./stake";
import { randomNumber } from "../../utilities";
import fundCampaign from "./fundCampaign";
import claimRewards from "./claimRewards";
import delegate from "./delegate";
import unDelegate from "./unDelegate";
import transferWNTV from "./transferWNTV";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { minutes } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";

task("e2e", "").setAction(async (_, hre) => {
  const actions = [claimRewards, stake, swap, transferWNTV, delegate, unDelegate, fundCampaign];
  const accounts = await hre.ethers.getSigners();

  while (true) {
    await Promise.all(
      actions.map(async action => {
        const accountStart = randomNumber(4, accounts.length - 1);
        const accountEnd = randomNumber(accountStart + 1, accountStart + 30);
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
      }),
    );

    await time.increase(minutes(randomNumber(5, 50)));
  }
});
