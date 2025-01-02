import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../../typechain-types";

task("runE2ELocalnet", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  if (hre.network.name != "localhost") {
    throw new Error("This task can only be run on localhost");
  }

  const router = await ethers.getContract<Router>("Router", deployer);
  const wnative = await router.getWrappedNativeToken();
  const paths = await Promise.all(
    (await router.pairs()).map(async address => {
      const pair = await ethers.getContractAt("Pair", address);
      const token0 = await pair.token0();
      const token1 = await pair.token1();

      return wnative == token1 ? [token0, token1] : [token1, token0];
    }),
  );

  const swapPath = paths.find(path => path.includes(wnative))!;

  const accounts = await ethers.getSigners();
  for (const tester of accounts) {
    const token0 = await ethers.getContractAt("ERC20", swapPath[0]);

    let amountIn = ethers.parseEther("0.001");

    // Acquire ERc20 token
    await router
      .connect(tester)
      .swapExactTokensForTokens(amountIn, 1, swapPath.slice().reverse(), tester.address, Number.MAX_SAFE_INTEGER, {
        value: amountIn,
      });

    amountIn = await token0.balanceOf(tester.address);

    await token0.connect(tester).approve(router, amountIn);

    const args = [amountIn, 1, swapPath, tester.address, Number.MAX_SAFE_INTEGER] as const;

    const RouterLib = require("../../verification/libs/localhost/Router.js");
    const RouterFactory = await ethers.getContractFactory("Router", { libraries: RouterLib });
    const referrerId = Math.floor(Math.random() * +(await router.totalUsers()).toString());
    return await router
      .connect(tester)
      .registerAndSwap(
        referrerId,
        RouterFactory.interface.encodeFunctionData(router.swapExactTokensForTokens.name, args),
      );
  }
});
