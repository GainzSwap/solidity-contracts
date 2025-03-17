import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Router, Views } from "../../typechain-types";
import {
  getAmount,
  getRandomItem,
  getSwapTokens,
  isAddressEqual,
  randomNumber,
  runInErrorBoundry,
} from "../../utilities";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getAddress, ZeroAddress } from "ethers";

export default async function stake(hre: HardhatRuntimeEnvironment, accounts: HardhatEthersSigner[]) {
  console.log("\nStaking");
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const wnative = await router.getWrappedNativeToken();
  const views = await ethers.getContract<Views>("Views", deployer);

  const { tradePairs, makePath, findBestPath } = await getSwapTokens(router, ethers);

  for (const account of accounts) {
    const [tokenA, tokenB] = makePath(getRandomItem(tradePairs));
    const aIsWNative = isAddressEqual(tokenA, wnative);
    const bIsWNative = isAddressEqual(tokenB, wnative);

    const pathToNative = aIsWNative
      ? [tokenB, tokenA]
      : bIsWNative
        ? [tokenA, tokenB]
        : findBestPath([tokenA, wnative]) || findBestPath([tokenB, wnative]);
    if (!pathToNative?.length) {
      console.log("No path to native for ", tokenA, tokenB);
      continue;
    }

    const { amount: amountInA } = await getAmount(account, tokenA, ethers, wnative);
    if (amountInA == 0n) continue;
    const amountOutMinA = 1n;
    const amountInB = await views.getQuote(amountInA, [tokenA, tokenB]);
    if (amountInB == 0n) continue;
    const amountOutMinB = 1n;

    for (const [address, amount] of [
      [tokenA, amountInA],
      [tokenB, amountInB],
    ] as const) {
      if (isAddressEqual(address, ZeroAddress)) continue;
      const token = await ethers.getContractAt("ERC20", address);
      await token.connect(account).approve(governance, amount);
    }

    const value = randomNumber(0, 100) >= 55 ? undefined : aIsWNative ? amountInA : bIsWNative ? amountInB : undefined;

    const hasEnoughBToken =
      (await (value && bIsWNative
        ? account.provider.getBalance(account.address)
        : (await ethers.getContractAt("ERC20", tokenB)).balanceOf(account))) > amountInB;
    if (!hasEnoughBToken) continue;

    await runInErrorBoundry(
      () =>
        governance
          .connect(account)
          .stakeLiquidity(
            { amount: amountInA, token: tokenA, nonce: 0 },
            { amount: amountInB, token: tokenB, nonce: 0 },
            randomNumber(0, 1081),
            [amountOutMinA, amountOutMinB, Number.MAX_SAFE_INTEGER],
            pathToNative,
            { value },
          ),
      ["AMMLibrary: INSUFFICIENT_AMOUNT"],
    );
    console.log(account.address, "staked");
  }
}
