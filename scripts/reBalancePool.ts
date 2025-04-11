import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { formatEther, formatUnits, parseEther, parseUnits } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getSwapTokens } from "../utilities";

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

    if (ratio <= parseEther("7.300490")) break;

    // const eduBal = await (await ethers.getContractAt("ERC20", edu)).balanceOf(deployer);
    // eduBal > 0n &&
    //   (await stake(
    //     hre,
    //     [await ethers.getSigner(deployer)],
    //     await (await ethers.getContractAt("ERC20", edu)).balanceOf(deployer),
    //   ));

    const usdcBal = await (await ethers.getContractAt("ERC20", usdc)).balanceOf(deployer);
    let amountIn = parseUnits("1", 6);
    if (usdcBal < amountIn) amountIn = usdcBal;
    if (amountIn <= 0n) break;

    const amountOut = (eduReserve * amountIn) / usdcReserve;

    const { hash } = await router.swapExactTokensForTokens(
      amountIn,
      (amountOut * 998n) / 1000n,
      [usdc, edu],
      "0x8D0739d9D0d49aFCF8d101416cD2759Bf8922013",
      deadline,
    );

    deadline += 50;

    console.log({ hash });
  }
});

async function stake(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[], amount: bigint) {
  console.log("\nStaking");
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const wnative = await router.getWrappedNativeToken();

  const { swapTokens } = await getSwapTokens(router, ethers);

  for (const account of accounts) {
    if (swapTokens.length < 2) continue;

    console.log(`Staking ${ethers.formatEther(amount)}`);

    const amountInA = amount / 2n;
    const amountOutMinA = 1n;
    const amountInB = amount - amountInA;
    const amountOutMinB = 1n;

    const usdc = swapTokens.find(token => token !== wnative)!;
    const pathA = [wnative];
    const pathB = [wnative, usdc];
    const pathToNative = [usdc, wnative];

    try {
      const { data } = await governance.connect(account).stake(
        { amount, token: pathA[0], nonce: 0 },
        120,
        [pathA, pathB, pathToNative],
        [
          [amountInA, amountOutMinA],
          [amountInB, amountOutMinB],
        ],
        Number.MAX_SAFE_INTEGER,
      );
    } catch (error) {
      console.error(error);
    }
  }
}
