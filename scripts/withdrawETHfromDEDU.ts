import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";

task("withdrawETHfromDEDU").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer, newFeeTo } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const wNative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());

  const to = hre.network.name == "localhost" ? newFeeTo : "0x68Fe50235230e24f17c90f8Fb0Cd4626fbD34972";

  await wNative.withdrawETHBalance(to);
});
