import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import swap from "./swap";
import stake from "./stake";
import { randomNumber, sleep } from "../../utilities";

task("runE2ELocalnet", "").setAction(async (_, hre) => {
  const actions = [swap, stake];
  const accounts = await hre.ethers.getSigners();

  while (true) {
    await sleep(randomNumber(1000, 6_000));
    const accountStart = randomNumber(0, accounts.length);
    const accountEnd = randomNumber(accountStart, accounts.length);

    await actions[randomNumber(0, actions.length)](hre, accounts.slice(accountStart, accountEnd));
  }
});
