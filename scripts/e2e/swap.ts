import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Router, Views } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  getAmount,
  getSwapTokens,
  isAddressEqual,
  randomNumber,
  runInErrorBoundry,
  sequentialRun,
} from "../../utilities";
import { slippageErrors } from "./errors";
import { sendToken } from "./transferToken";
import { formatUnits, parseUnits } from "ethers";

export default async function swap(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("Swapping");
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const views = await ethers.getContract<Views>("Views", deployer);
  const wnative = await router.getWrappedNativeToken();

  const { swapTokens, findBestPath, selectTokens } = await getSwapTokens(router, ethers);

  if (swapTokens.length < 2) return;

  await Promise.all(
    accounts.map(async tester => {
      const { tokenIn, tokenOut } = selectTokens();
      let { amount: amountIn, isNative, decimals } = await getAmount(tester, tokenIn, ethers, wnative);

      const run = () =>
        execSwap({
          swapPath: findBestPath([tokenIn, tokenOut]),
          amountIn,
          tokenIn,
          router,
          ethers,
          tester,
          views,
          isNative,
        });

      let report = await run();
      if (report.includes("Low amount to swap")) {
        const { newFeeTo } = await hre.getNamedAccounts();
        const feeTo = await hre.ethers.getSigner(newFeeTo);

        if (amountIn < 10_000n) {
          amountIn = parseUnits("0.01", decimals);
        }

        await sequentialRun(feeTo, async seqAcc => {
          let rerun = false;
          do {
            try {
              await sendToken(await ethers.getContractAt("ERC20", tokenIn), amountIn, seqAcc, tester.address);
            } catch (error) {
              // const err = error?.toString();
              // if (err?.includes("nonce too low") || err?.includes("nonce too high")) {
              //   rerun = true;
              //   console.log("Rerun sendToken", tester.address, tokenIn, amountIn);
              // }
            }
          } while (rerun);
        });

        report = await run();
      }

      console.log(tester.address, ...report, formatUnits(amountIn, decimals), tokenIn, tokenOut);
    }),
  );
}

export async function execSwap({
  swapPath,
  amountIn,
  tokenIn,
  router,
  ethers,
  tester,
  views,
  isNative,
}: {
  swapPath: string[] | null;
  amountIn: bigint;
  tokenIn: string;
  router: Router;
  ethers: any;
  tester: HardhatEthersSigner;
  views: Views;
  isNative: boolean;
}) {
  if (!swapPath || swapPath.length < 2 || !isAddressEqual(tokenIn, swapPath[0])) return "Invalid swap path";

  if (amountIn <= 10_000n) return "Low amount to swap";

  const token0 = await ethers.getContractAt("ERC20", tokenIn);
  await token0.connect(tester).approve(router, 2n ** 251n);

  const maxOutAmount = await views.getQuote(amountIn, swapPath);
  const minAmountOut = (maxOutAmount * 1000n) / (BigInt(randomNumber(1, 10).toFixed()) * 1000n);
  if (minAmountOut < 1n) return "Low min amount out";

  const args = [amountIn, minAmountOut, swapPath, tester.address, Number.MAX_SAFE_INTEGER] as const;
  const RouterLib = require("../../verification/libs/localhost/Router.js");
  const RouterFactory = await ethers.getContractFactory("Router", { libraries: RouterLib });
  const referrerId = randomNumber(0, +(await router.totalUsers()).toString());

  const value = isNative ? amountIn : undefined;
  await runInErrorBoundry(
    () =>
      router
        .connect(tester)
        .registerAndSwap(
          referrerId,
          RouterFactory.interface.encodeFunctionData(router.swapExactTokensForTokens.name, args),
          { value },
        ),
    [...slippageErrors],
  );

  return ["Swapped", tester.address, amountIn, swapPath];
}
