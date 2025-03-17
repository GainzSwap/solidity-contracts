import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getAmount, getSwapTokens, isAddressEqual, randomNumber } from "../../utilities";

export default async function swap(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("Swapping");
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const wnative = await router.getWrappedNativeToken();

  const { swapTokens, findBestPath, selectTokens } = await getSwapTokens(router, ethers);

  if (swapTokens.length < 2) return;

  await Promise.all(
    accounts.map(async tester => {
      const { tokenIn, tokenOut } = selectTokens();
      const swapPath = findBestPath([tokenIn, tokenOut]);

      if (!swapPath || swapPath.length < 2 || !isAddressEqual(tokenIn, swapPath[0])) return;

      const { amount: amountIn, isNative } = await getAmount(tester, tokenIn, ethers, wnative);
      if (amountIn == 0n) return;

      const token0 = await ethers.getContractAt("ERC20", tokenIn);
      await token0.connect(tester).approve(router, 2n ** 251n);

      const args = [amountIn, 1, swapPath, tester.address, Number.MAX_SAFE_INTEGER] as const;
      const RouterLib = require("../../verification/libs/localhost/Router.js");
      const RouterFactory = await ethers.getContractFactory("Router", { libraries: RouterLib });
      const referrerId = randomNumber(0, +(await router.totalUsers()).toString());

      const value = isNative ? amountIn : undefined;
      await router
        .connect(tester)
        .registerAndSwap(
          referrerId,
          RouterFactory.interface.encodeFunctionData(router.swapExactTokensForTokens.name, args),
          { value },
        );

      console.log("Swapped", tester.address, amountIn, swapPath);
    }),
  );
}
