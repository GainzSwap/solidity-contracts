import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import fs from "fs";
import path from "path";
import { Router } from "../../typechain-types";
import { getRouterLibraries } from "../../utilities";

task("runE2ELocalnet", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  if (hre.network.name != "localhost") {
    throw new Error("This task can only be run on localhost");
  }
  const walletPath = path.join(__dirname, "./wallets.json");

  if (!fs.existsSync(walletPath)) {
    const walletContent = new Array(10).fill(0).map(() => {
      const randomWallet = ethers.Wallet.createRandom();
      return {
        privateKey: randomWallet.privateKey,
        publicKey: randomWallet.address,
        balance: "0",
      };
    });

    fs.writeFileSync(walletPath, JSON.stringify(walletContent, null, 2));
  }

  const testWallets: { privateKey: string; publicKey: string; balance: string }[] = require("./wallets.json");
  await Promise.all(
    testWallets.map(async tester =>
      (await ethers.getSigner(deployer)).sendTransaction({ value: ethers.parseEther("99"), to: tester.publicKey }),
    ),
  );

  const RouterFactory = await ethers.getContractFactory("Router", {
    libraries: await getRouterLibraries(ethers),
  });
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

  await Promise.all(
    testWallets.map(async (tester, index) => {
      const signer = new ethers.Wallet(tester.privateKey, ethers.provider);
      const token0 = await ethers.getContractAt("ERC20", swapPath[0]);

      let amountIn = ethers.parseEther("0.001");

      // Acquire ERc20 token
      await router
        .connect(signer)
        .swapExactTokensForTokens(amountIn, 1, swapPath.slice().reverse(), tester.publicKey, Number.MAX_SAFE_INTEGER, {
          value: amountIn,
        });

      amountIn = await token0.balanceOf(tester.publicKey);

      await token0.connect(signer).approve(router, amountIn);

      const args = [amountIn, 1, swapPath, tester.publicKey, Number.MAX_SAFE_INTEGER] as const;

      return await router
        .connect(signer)
        // .swapExactTokensForTokens(...args);
        .registerAndSwap(
          await router.totalUsers(),
          RouterFactory.interface.encodeFunctionData(router.swapExactTokensForTokens.name, args),
        );
    }),
  );
});
