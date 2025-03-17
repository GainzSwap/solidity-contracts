import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import swap from "./swap";
import stake from "./stake";
import { randomNumber } from "../../utilities";
import fundCampaign from "./fundCampaign";
import claimRewards from "./claimRewards";
import delegate from "./delegate";
import unDelegate from "./unDelegate";
import transferToken from "./transferToken";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { minutes, seconds } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";
import unStake from "./unStake";
import completeCampaign from "./completeCampaign";

task("e2e", "").setAction(async (_, hre) => {
  const actions = [
    completeCampaign,
    claimRewards,
    stake,
    unStake,
    swap,
    transferToken,
    delegate,
    unDelegate,
    fundCampaign,
  ];
  const accounts = await hre.ethers.getSigners();

  while (true) {
    await Promise.all(
      actions.map(async action => {
        const accountStart = randomNumber(4, accounts.length);
        const accountEnd = randomNumber(accountStart + 1, accountStart + 30);
        const selectedAccounts = accounts.slice(accountStart, accountEnd);

        try {
          await action(hre, selectedAccounts);
        } catch (error: any) {
          console.log("runing", action.name);

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

    await time.increase(seconds(randomNumber(1, 43_200)));
  }
});
