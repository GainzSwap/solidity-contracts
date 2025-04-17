import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Gainz, GToken, Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getRandomItem, randomNumber, runInErrorBoundry } from "../../utilities";

export default async function transferToken(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\ntransferToken");

  for (const account of accounts) {
    const sendTo = getRandomItem(
      hre.network.name == "localhost" ? await hre.getUnnamedAccounts() : accounts.map(a => a.address),
    );
    await sendRandToken(account, sendTo, hre);
  }
}

export const sendRandToken = async (
  account: HardhatEthersSigner,
  sendTo: string,
  hre: HardhatRuntimeEnvironment,
  nonce_?: number,
) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const wnative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());
  const gToken = await ethers.getContractAt("GToken", await governance.getGToken());

  const token = getRandomItem([gainz, wnative, gToken]);
  const isERC20 = (t: any): t is typeof gainz => "transfer" in t;

  console.log(`Transferring ${await token.name()} from ${account.address} to ${sendTo}`);

  if (!isERC20(token)) {
    const bals = await gToken.getGTokenBalance(account);
    if (!bals.length) return;
    const bal = getRandomItem(bals); // bals.find(bal => bal.attributes.epochsLocked == 0n);
    if (!bal) return;
    const { nonce, amount } = bal;

    await runInErrorBoundry(
      () =>
        // gToken.connect(account).split(nonce, [account.address, sendTo], [(amount * 98n) / 100n, (amount * 2n) / 100n], {
        //   nonce: nonce_,
        // }),
        gToken.connect(account).safeTransferFrom(account, sendTo, nonce, amount, Buffer.from("")),
      ["SFT: Must transfer all"],
    );
  } else {
    const amount = await token.balanceOf(account.address).then(bal => {
      const randBal = Math.floor(Math.random() * +bal.toString());
      return BigInt(randBal) / 100n;
    });

    await token.connect(account).transfer(sendTo, amount, { nonce: nonce_ });
  }
};
