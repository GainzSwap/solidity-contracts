import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router, Views } from "../typechain-types";
import { getSwapTokens } from "../utilities";

task("removeLiqFees").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer, newFeeTo } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const views = await ethers.getContract<Views>("Views", deployer);
  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);

  const pairs = await router.pairs();

  const feeToSigner = await ethers.getSigner(newFeeTo);

  for (const pairAddr of pairs) {
    const pair = await ethers.getContractAt("Pair", pairAddr);
    const liquidity = await pair.balanceOf(feeToSigner);

    if (liquidity > 0n) {
      const token0 = await ethers.getContractAt("ERC20", await pair.token0());
      const token1 = await ethers.getContractAt("ERC20", await pair.token1());

      const [token0Amount, token1Amount] = await views
        .getLiquidityValue(token0, token1, liquidity)
        .then(amounts => amounts.map(amount => (amount * 90n) / 100n));
      if (token0Amount == 0n || token1Amount == 0n) continue;

      await pair.connect(feeToSigner).approve(router, liquidity);

      console.log(
        `Removing liquidity from ${pairAddr} (${await pair.symbol()}) for ${liquidity} tokens: ${token0Amount} ${await token0.symbol()} and ${token1Amount} ${await token1.symbol()}`,
      );
      await router
        .connect(feeToSigner)
        .removeLiquidity(
          token0,
          token1,
          liquidity,
          token0Amount,
          token1Amount,
          feeToSigner.address,
          ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) + 500,
        );
    }
  }

  const { findBestPath, swapTokens } = await getSwapTokens(router, ethers);
  const gainzAddr = await gainz.getAddress();
  for (const token of swapTokens) {
    const path = findBestPath([token, gainzAddr]);
    if (!path || path.length < 2) continue;

    const tokenContract = await ethers.getContractAt("ERC20", token);
    const tokenBalance = await tokenContract.balanceOf(feeToSigner.address);

    if (tokenBalance > 0n) {
      await tokenContract.connect(feeToSigner).approve(router, tokenBalance);
      const maxOutAmount = await views.getQuote(tokenBalance, path);

      console.log(
        `Swapping ${tokenBalance} ${await tokenContract.symbol()} to ${gainzAddr} (${await gainz.symbol()})`,
      );
      await router
        .connect(feeToSigner)
        .swapExactTokensForTokens(
          tokenBalance,
          (maxOutAmount * 90n) / 100n, // 10% slippage
          path,
          feeToSigner.address,
          ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) + 500,
        )
        .catch(console.error);
    }
  }

  const gainzBalance = await gainz.balanceOf(feeToSigner.address);
  if (gainzBalance > 0n) {
    console.log(
      `Burning ${gainzBalance} ${await gainz.symbol()} from ${feeToSigner.address} (${gainzAddr})`,
      gainzBalance,
    );
    await gainz.connect(feeToSigner).burn(gainzBalance);
  }
});
