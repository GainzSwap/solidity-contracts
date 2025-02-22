import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { formatEther, formatUnits, parseEther } from "ethers";

task("reBalancePool").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer, newFeeTo } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const gToken = await ethers.getContractAt("GToken", await governance.getGToken());
  const launchPair = await ethers.getContractAt("LaunchPair", await governance.launchPair());

  const [pairAddr] = await router.pairs();

  const pair = await ethers.getContractAt("Pair", pairAddr);
  const token0 = await ethers.getContractAt("ERC20", await pair.token0());
  const token1 = await ethers.getContractAt("ERC20", await pair.token1());

  const gTokenSupply = await gToken.totalSupply();
  const totalPairLiq = await pair.totalSupply();
  const [userGTokenAmount, userPairLiq] = (await gToken.getGTokenBalance(deployer)).reduce(
    ([gTokenTotal, liquidity], cur) => [gTokenTotal + cur.amount, liquidity + cur.attributes.lpDetails.liquidity],
    [0n, 0n],
  );

  const wntv = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());
  const { fundsRaised } = await launchPair.getCampaignDetails(1);
  const totalDEDU = await wntv.totalSupply();

  // const { reserve0, reserve1 } = await pair.getReserves();

  // await token0.approve(router, reserve0);
  // await token1.approve(router, reserve1);

  const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
  let deadline = (block?.timestamp || 0) + 50;
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

    console.log({
      tvl: formatEther(eduReserve + fundsRaised + totalDEDU),
      liqPercent: formatUnits((userPairLiq * 100_00n) / totalPairLiq, 2),
      eduShare: formatEther((userPairLiq * eduReserve) / totalPairLiq),
      usdcShare: formatUnits((userPairLiq * usdcReserve) / totalPairLiq, 6),
    });

    if (ratio <= parseEther("3.732700")) break;

    const amountIn = (usdcReserve * 4n) / 10_000n;
    const amountOut = (eduReserve * amountIn) / usdcReserve;

    const { hash } = await router.swapExactTokensForTokens(
      amountIn,
      (amountOut * 999n) / 1000n,
      [usdc, edu],
      deployer,
      deadline,
    );

    deadline += 50;

    console.log({ hash });
  }
});
