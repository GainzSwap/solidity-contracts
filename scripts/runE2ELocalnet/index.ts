import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import swap from "./swap";
import stake from "./stake";
import { randomNumber, sleep } from "../../utilities";
import axios from "axios";

task("runE2ELocalnet", "").setAction(async (_, hre) => {
  const actions = [swap, stake];
  const accounts = await hre.ethers.getSigners();

  while (true) {
    const accountStart = randomNumber(0, accounts.length);
    const accountEnd = randomNumber(accountStart, accounts.length);
    const selectedAccounts = accounts.slice(accountStart, accountEnd);

    await actions[randomNumber(0, actions.length)](hre, selectedAccounts);

    await Promise.all(
      selectedAccounts.map(account =>
        axios.get("http://localhost:3000/api/user/stats/" + account.address + "?chainId=31337"),
      ),
    );
    
    await sleep(randomNumber(1000, 6_000));
  }
});
