import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Gainz, GToken, Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getRandomItem, randomNumber, runInErrorBoundry } from "../../utilities";

export default async function transferToken(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\ntransferToken");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const wnative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());
  const gToken = await ethers.getContractAt("GToken", await governance.getGToken());

  const token = getRandomItem([gainz, wnative, gToken]);

  for (const account of accounts) {
    const sendTo = getRandomItem(await hre.getUnnamedAccounts());
    console.log(`Transferring ${await token.name()} from ${account.address} to ${sendTo}`);
    if (token == gToken) {
      const bals = await gToken.getGTokenBalance(account);
      if (!bals.length) continue;
      const { nonce, amount } = getRandomItem(bals);

      await runInErrorBoundry(
        () => gToken.connect(account).safeTransferFrom(account, sendTo, nonce, amount, Buffer.from("")),
        ["SFT: Must transfer all"],
      );
    } else {
      const amount = await (token as typeof gainz).balanceOf(account.address).then(bal => {
        const randBal = Math.floor(Math.random() * +bal.toString());
        return BigInt(randBal) / 10_000n;
      });

      await wnative.connect(account).transfer(sendTo, amount);
    }
  }
}
