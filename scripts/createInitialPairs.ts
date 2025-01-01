import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router } from "../typechain-types";
import { parseEther } from "ethers";

task("createInitialPairs", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const gainzAddress = await gainz.getAddress();

  const wNativeToken = await router.getWrappedNativeToken();

  console.log("\n\nCreating Pair", { gainzAddress, wNativeToken }, "\n\n");

  const gainzPayment = { token: gainzAddress, nonce: 0, amount: parseEther("185.1851852") };
  const nativePayment = { token: wNativeToken, nonce: 0, amount: parseEther("500") };

  try {
    await gainz.approve(router, gainzPayment.amount);
    await router.createPair(gainzPayment, nativePayment, { value: nativePayment.amount });
  } catch (error) {
    console.log(error);
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
