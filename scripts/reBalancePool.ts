import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router, Views } from "../typechain-types";
import { formatEther, formatUnits, parseEther, parseUnits, ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getSwapTokens, isAddressEqual } from "../utilities";

task("reBalancePool").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer, newFeeTo } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const views = await ethers.getContract<Views>("Views", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());

  const [usdcEdu, gainzEdu] = await router.pairs();

  const gainzEduPair = await ethers.getContractAt("Pair", gainzEdu);
  const usdcEduPair = await ethers.getContractAt("Pair", usdcEdu);

  const gainzAddy = await governance.getGainzToken();
  const dEDU = await router.getWrappedNativeToken();

  const gainz = await ethers.getContractAt("Gainz", gainzAddy);
  // await gainz.approve(router, 2n ^ 251n);
  const usdc = "0x836d275563bAb5E93Fd6Ca62a95dB7065Da94342";

  // const { reserve0, reserve1 } = await pair.getReserves();

  // await token0.approve(router, reserve0);
  // await token1.approve(router, reserve1);

  const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
  let deadline = 2n ** 251n; // (block?.timestamp || 0) + 50;
  while (true) {
    const [[gainzReserve, eduReserveGAinZ]] = await Promise.all(
      [gainzEduPair].map(async pair => {
        const { reserve0, reserve1 } = await pair.getReserves();
        const token0 = await pair.token0();

        return isAddressEqual(token0, dEDU) ? [reserve1, reserve0] : [reserve0, reserve1];
      }),
    );

    // console.log({ usdcReserve: formatUnits(usdcReserve, 6), eduReserve: formatEther(eduReserve) });
    const price = await views.getQuote(parseEther("1"), [dEDU, usdc]);
    console.log({ price: formatUnits(price, 6) });

    if (price <= parseUnits("0.05", 6)) break;

    // const eduBal = await (await ethers.getContractAt("ERC20", edu)).balanceOf(deployer);
    // eduBal > 0n &&
    //   (await stake(
    //     hre,
    //     [await ethers.getSigner(deployer)],
    //     await (await ethers.getContractAt("ERC20", edu)).balanceOf(deployer),
    //   ));

    const gainzBal = await gainz.balanceOf(deployer);
    let amountIn = (gainzReserve * 4n) / 10n;
    if (gainzBal < amountIn) amountIn = gainzBal;
    if (amountIn <= 0n) break;

    const path = [gainzAddy, dEDU, usdc];
    let h = await views.getAmountsOut(amountIn, path);
    let amountOut = h.at(-1)![0];
    amountOut *= 95n;
    amountOut /= 100n;

    console.log({ amountIn: formatEther(amountIn), amountOut: formatUnits(amountOut, 6), path, deadline, deployer });

    await gainz.approve(router, amountIn);

    const { hash } = await router.swapExactTokensForTokens(amountIn, amountOut, path, deployer, deadline);

    // deadline += 50;

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
