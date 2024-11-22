import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router } from "../typechain-types";
import { parseEther } from "ethers";

task("createInitialPairs", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  if (hre.network.name != "localhost" && !process.env.STABLE_COIN_ADDRESS) {
    throw new Error("Stable Coin address not set");
  }

  const router = await ethers.getContract<Router>("Router", deployer);
  const stableCoinAddress =
    process.env.STABLE_COIN_ADDRESS ||
    (await (await ethers.deployContract("TestERC20", ["Stable Coin", "STB", 4])).getAddress());

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const gainzAddress = await gainz.getAddress();

  const wNativeToken = await router.getWrappedNativeToken();

  for (const [tokenA, tokenB] of [
    [gainzAddress, stableCoinAddress],
    [wNativeToken, gainzAddress],
    [wNativeToken, stableCoinAddress],
  ]) {
    try {
      await (await ethers.getContractAt("ERC20", tokenA)).approve(router, parseEther("1"));
    } catch (error) {}

    await (await ethers.getContractAt("ERC20", tokenB)).approve(router, parseEther("1"));

    console.log("\n\nCreating Pair", { tokenA, tokenB, wNativeToken }, "\n\n");

    try {
      await router.createPair(
        { token: tokenA, nonce: 0, amount: parseEther("1") },
        { token: tokenB, nonce: 0, amount: parseEther("0.005") },
        { value: tokenA == wNativeToken ? parseEther("1") : 0 },
      );
    } catch (error) {
      console.log(error);
    }
  }

  if (hre.network.name == "localhost") {
    // Send network tokens
    const testers = process.env.TESTERS?.split(",") ?? [];
    await Promise.all(
      testers.map(async tester =>
        (await ethers.getSigner(deployer)).sendTransaction({ value: parseEther("99"), to: tester }),
      ),
    );
  }
});
