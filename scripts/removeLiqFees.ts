import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router, Views } from "../typechain-types";

task("removeLiqFees").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer, newFeeTo } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const views = await ethers.getContract<Views>("Views", deployer);

  const pairs = await router.pairs();

  const feeToSigner = await ethers.getSigner(newFeeTo);

  for (const pairAddr of pairs) {
    const pair = await ethers.getContractAt("Pair", pairAddr);
    const liquidity = await pair.balanceOf(feeToSigner);

    if (liquidity > 0n) {
      const token0 = await ethers.getContractAt("ERC20", await pair.token0());
      const token1 = await ethers.getContractAt("ERC20", await pair.token1());

      const [token0Amount, token1Amount] = await views.getLiquidityValue(token0, token1, liquidity);

      await pair.connect(feeToSigner).approve(router, liquidity);

      await router.connect(feeToSigner).removeLiquidity(
        token0,
        token1,
        liquidity,
        token0Amount,
        token1Amount,
        "0x173a573Cb43Fe0608007c5b4371d6B70E08a63f3", // Team wallet,
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) + 500,
      );
    }
  }
});
