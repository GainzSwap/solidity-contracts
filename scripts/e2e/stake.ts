import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Router } from "../../typechain-types";
import { getAmount, getSwapTokens, randomNumber } from "../../utilities";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export default async function stake(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\nStaking");
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const wnative = await router.getWrappedNativeToken();

  const { swapTokens } = await getSwapTokens(router, ethers);

  for (const account of accounts) {
    if (swapTokens.length < 2) continue;
    const [tokenA, tokenB] = [
      swapTokens.splice(randomNumber(0, swapTokens.length), 1)[0],
      swapTokens.splice(randomNumber(0, swapTokens.length), 1)[0],
    ];

    const amount = await getAmount(account, tokenA, ethers, wnative);
    console.log(`Staking ${ethers.formatEther(amount)}`);

    if (tokenA !== wnative) {
      const token0 = await ethers.getContractAt("ERC20", tokenA);
      await token0.connect(account).approve(governance, amount);
    }
    const amountInA = (BigInt(randomNumber(25, 70).toFixed(0)) * amount) / 100n;
    const amountOutMinA = 1n;
    const amountInB = amount - amountInA;
    const amountOutMinB = 1n;
    try {
      await governance.connect(account).stake(
        { amount, token: tokenA, nonce: 0 },
        randomNumber(0, 1081),
        [[tokenA], [tokenA, tokenB], tokenA === wnative ? [] : [tokenA, wnative]],
        [
          [amountInA, amountOutMinA],
          [amountInB, amountOutMinB],
        ],
        Number.MAX_SAFE_INTEGER,
        { value: tokenA === wnative ? amount : 0 },
      );
    } catch (error) {
      console.error(error);
    }
  }
}
