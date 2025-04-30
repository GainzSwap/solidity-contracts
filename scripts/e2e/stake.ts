import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Gainz, Router, Views } from "../../typechain-types";
import {
  extendArray,
  fundIfNeeded,
  getAmount,
  getRandomItem,
  getSwapTokens,
  isAddressEqual,
  randomNumber,
  runInErrorBoundry,
  sequentialRun,
  shuffleArray,
} from "../../utilities";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getAddress, ZeroAddress } from "ethers";
import { slippageErrors } from "./errors";
import { execSwap } from "./swap";
import { sendToken } from "./transferToken";
import path from "path";

export default async function stake(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[], fund = false) {
  console.log("\nStaking");

  const { ethers } = hre;
  const { deployer, newFeeTo } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const wnative = await router.getWrappedNativeToken();
  const views = await ethers.getContract<Views>("Views", deployer);

  const { tradePairs, makePath, findBestPath } = await getSwapTokens(router, ethers);
  const feeTo = await ethers.getSigner(newFeeTo);

  for (const account of accounts) {
    const [tokenA, tokenB] = makePath(getRandomItem(shuffleArray(extendArray(tradePairs, 20))));
   
    const aIsWNative = isAddressEqual(tokenA, wnative);
    const bIsWNative = isAddressEqual(tokenB, wnative);

    const pathToNative = aIsWNative
      ? [tokenB, tokenA]
      : bIsWNative
        ? [tokenA, tokenB]
        : findBestPath([tokenA, wnative]) || findBestPath([tokenB, wnative]);

    if (!pathToNative?.length) {
      console.log("No path to native for", tokenA, tokenB);
      continue;
    }

    const slippage = BigInt(randomNumber(1, 10));
    const _100Percent = 1000n;

    const applySlippage = (amount: bigint): bigint => {
      return amount - (amount * slippage) / _100Percent;
    };

    const { amount: amountInA, isNative: aIsNative, decimals } = await getAmount(account, tokenA, ethers, wnative);
    if (amountInA === 0n) continue;

    const amountOutMinA = applySlippage(amountInA);
    const amountInB = await views.getQuote(amountInA, [tokenA, tokenB]);
    if (amountInB === 0n) continue;

    const amountOutMinB = applySlippage(amountInB);
    if (amountOutMinA < 1n || amountOutMinB < 1n) continue;

    console.log(account.address, "Preparing to stake");

    const tokenSymbols: string[] = [];

    if (fund) {
      await sequentialRun(feeTo, async seqAcc => {
        await fundIfNeeded(hre.ethers.provider, account, seqAcc, 0);

        for (const [address, amount] of [
          [tokenA, amountInA],
          [tokenB, amountInB],
        ] as const) {
          if (!isAddressEqual(address, ZeroAddress)) {
            const token = await ethers.getContractAt("ERC20", address);
            const balance = await token.balanceOf(account.address);
            tokenSymbols.push(await token.symbol());

            if (balance < amount) {
              await sendToken(token, amount, seqAcc, account.address);
            }

            const allowance = await token.allowance(account.address, governance);
            if (allowance < amount) {
              await token.connect(account).approve(governance, 2n ** 251n);
            }
          }
        }
      });
    }

    await sequentialRun(account, async seqAcc => {
      await governance
        .connect(seqAcc)
        .stakeLiquidity(
          { amount: amountInA, token: tokenA, nonce: 0 },
          { amount: amountInB, token: tokenB, nonce: 0 },
          randomNumber(900, 1030), // simulate epochs randomisation
          [amountOutMinA, amountOutMinB, Number.MAX_SAFE_INTEGER],
          pathToNative,
          { value: aIsNative ? amountInA : undefined },
        )
        .catch(e => {
          console.log("Error Staking", tokenSymbols.join(" & "), {
            tokenA,
            tokenB,
            amountInA,
            amountInB,
            aIsNative,
            amountOutMinA,
            amountOutMinB,
            pathToNative,
            slippage,
          });

          throw e;
        });

      console.log(seqAcc.address, "Staked", {
        tokenSymbols: tokenSymbols.join(" & "),
        amountInA: amountInA.toString(),
        amountInB: amountInB.toString(),
      });
    });
  }
}
