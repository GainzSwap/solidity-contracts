import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getSwapTokens } from "../utilities";
import { sendToken } from "./e2e/transferToken";

task("teamTokens").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer, newFeeTo } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const gToken = await ethers.getContractAt("GToken", await governance.getGToken());

  const bal = await gToken.getGTokenBalance(deployer);
  for (const { nonce } of bal) {
    const ha = await sendToken(
      gToken,
      await ethers.getSigner(deployer),
      "0x173a573Cb43Fe0608007c5b4371d6B70E08a63f3",
      nonce,
    );

    console.log("Hash", ha?.hash, { nonce });
  }
});

async function stake(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[], amount: bigint) {
  console.log("\nStaking");
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const wnative = await router.getWrappedNativeToken();

  const { swapTokens } = await getSwapTokens(router, ethers);

  for (const account of accounts) {
    if (swapTokens.length < 2) continue;

    console.log(`Staking ${ethers.formatEther(amount)}`);

    const amountInA = amount / 2n;
    const amountOutMinA = 1n;
    const amountInB = amount - amountInA;
    const amountOutMinB = 1n;

    const usdc = swapTokens.find(token => token !== wnative)!;
    const pathA = [wnative];
    const pathB = [wnative, usdc];
    const pathToNative = [usdc, wnative];

    try {
      const { data } = await governance.connect(account).stake(
        { amount, token: pathA[0], nonce: 0 },
        120,
        [pathA, pathB, pathToNative],
        [
          [amountInA, amountOutMinA],
          [amountInB, amountOutMinB],
        ],
        Number.MAX_SAFE_INTEGER,
      );
    } catch (error) {
      console.error(error);
    }
  }
}
