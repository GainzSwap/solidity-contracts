import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Router } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getAmount, getSwapTokens, randomNumber } from "../../utilities";

export default async function swap(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("Swapping");
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const wnative = await router.getWrappedNativeToken();

  const { swapTokens, swapTokenPath } = await getSwapTokens(router, ethers);

  if (swapTokens.length < 2) return;
  const [inToken, outToken] = [
    swapTokens.splice(randomNumber(0, swapTokens.length), 1)[0],
    swapTokens.splice(randomNumber(0, swapTokens.length), 1)[0],
  ];

  const swapPath = swapTokenPath[inToken + outToken] ?? [inToken, ...swapTokens, outToken];
  if (swapPath.length < 2) return;

  await Promise.all(
    accounts.map(async tester => {
      const amountIn = await getAmount(tester, swapPath[0], ethers, wnative);
      console.log("Swapping", { tester: tester.address, amountIn: ethers.formatEther(amountIn) });

      if (swapPath[0] !== wnative) {
        const token0 = await ethers.getContractAt("ERC20", swapPath[0]);
        await token0.connect(tester).approve(router, amountIn);
      }

      const args = [amountIn, 1, swapPath, tester.address, Number.MAX_SAFE_INTEGER] as const;
      const RouterLib = require("../../verification/libs/localhost/Router.js");
      const RouterFactory = await ethers.getContractFactory("Router", { libraries: RouterLib });
      const referrerId = randomNumber(0, +(await router.totalUsers()).toString());

      await router
        .connect(tester)
        .registerAndSwap(
          referrerId,
          RouterFactory.interface.encodeFunctionData(router.swapExactTokensForTokens.name, args),
          { value: swapPath[0] === wnative ? amountIn : 0 },
        );
    }),
  );
}
