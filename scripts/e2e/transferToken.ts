import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ERC20, Gainz, GToken, Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getRandomItem } from "../../utilities";

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
  token: ERC20 | GToken,
  amount: bigint,
  account: HardhatEthersSigner,
  sendTo: string,
  gTokenNonce?: number,
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

    return token.connect(account).safeTransferFrom(account, sendTo, bal.nonce, bal.amount, Buffer.from(""));
  } else {
    return token.connect(account).transfer(sendTo, amount);
  }
};
