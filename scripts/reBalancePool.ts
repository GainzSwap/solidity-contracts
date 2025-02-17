import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { formatEther, formatUnits, parseEther, parseUnits } from "ethers";

task("reBalancePool").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer, newFeeTo } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);

  const pair = await ethers.getContractAt("Pair", "0xE9DDDDAB75354Ab7ea2365e66902CA61930796C4");
  const token0 = await ethers.getContractAt("ERC20", await pair.token0());
  const token1 = await ethers.getContractAt("ERC20", await pair.token1());

  // const { reserve0, reserve1 } = await pair.getReserves();

  // await token0.approve(router, reserve0);
  // await token1.approve(router, reserve1);

  const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
  let deadline = (block?.timestamp || 0) + 500;
  while (true) {
    const { reserve0, reserve1 } = await pair.getReserves();
    const [[usdc, usdcReserve], [edu, eduReserve]] =
      reserve0 < reserve1
        ? [
            [token0, reserve0],
            [token1, reserve1],
          ]
        : [
            [token1, reserve1],
            [token0, reserve0],
          ];

    console.log({ usdcReserve: formatUnits(usdcReserve, 6), eduReserve: formatEther(eduReserve) });
    const ratio = (eduReserve / usdcReserve) * 10n ** 6n;
    console.log({ ratio: formatEther(ratio) });
    if (ratio <= parseEther("3.33333333")) break;

    const amountIn = (usdcReserve * 18n) / 10_000n;
    const amountOut = (eduReserve * amountIn) / usdcReserve;

    const { hash } = await router.swapExactTokensForTokens(
      amountIn,
      (amountOut * 999n) / 1000n,
      [usdc, edu],
      deployer,
      deadline,
    );

    deadline += 500;

    console.log({ hash });
  }
});
