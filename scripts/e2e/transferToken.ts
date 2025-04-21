import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Gainz, GToken, Router, WNTV } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getRandomItem, randomNumber, runInErrorBoundry } from "../../utilities";
import { BigNumberish } from "ethers";

export default async function transferToken(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\ntransferToken");

  for (const account of accounts) {
    const sendTo = getRandomItem(
      hre.network.name == "localhost" ? await hre.getUnnamedAccounts() : accounts.map(a => a.address),
    );
    await sendRandToken(account, sendTo, hre);
  }
}

export const sendRandToken = async (account: HardhatEthersSigner, sendTo: string, hre: HardhatRuntimeEnvironment) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const wnative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());
  const gToken = await ethers.getContractAt("GToken", await governance.getGToken());

  const token = getRandomItem([gainz, wnative, gToken]);
};

export const sendToken = async (
  token: Gainz | WNTV | GToken,
  account: HardhatEthersSigner,
  sendTo: string,
  gTokenNonce?: BigNumberish,
) => {
  const isGToken = (t: any): t is GToken => "split" in t;

  console.log(`Transferring ${await token.name()} from ${account.address} to ${sendTo}`);

  if (isGToken(token)) {
    const bal = gTokenNonce
      ? await token.getBalanceAt(account, gTokenNonce)
      : await (async () => {
          const bals = await token.getGTokenBalance(account);
          if (!bals.length) return;
          return getRandomItem(bals); // bals.find(bal => bal.attributes.epochsLocked == 0n);
        })();

    if (!bal) return;
    const { nonce, amount } = bal;

    return token.connect(account).safeTransferFrom(account, sendTo, nonce, amount, Buffer.from(""));
  } else {
    const amount = await token.balanceOf(account.address).then(bal => {
      const randBal = Math.floor(Math.random() * +bal.toString());
      return BigInt(randBal) / 100n;
    });

    return token.connect(account).transfer(sendTo, amount);
  }
};
