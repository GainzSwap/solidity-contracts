import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Gainz, Router } from "../../typechain-types";
import { randomNumber } from "../../utilities";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import vote from "./vote";

export default async function stake(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\nStaking");

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const wnative = await router.getWrappedNativeToken();

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const gainzAddress = await gainz.getAddress();

  const governance = await ethers.getContractAt("Governance", await router.getGovernance());

  for (const account of accounts) {
    const amount = await ethers.provider.getBalance(account.address).then(bal => {
      const randBal = Math.floor(Math.random() * +bal.toString());
      return BigInt(randBal) / 10_000n;
    });

    console.log(`Staking ${ethers.formatEther(amount)}`);

    try {
      await governance
        .connect(account)
        .stake(
          { amount, token: wnative, nonce: 0 },
          randomNumber(800, 1080),
          [[wnative], [wnative, gainzAddress], []],
          1n,
          1n,
          { value: amount },
        );
    } catch (error) {
      console.error(error);
    }
  }
}
