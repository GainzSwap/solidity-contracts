import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";

task("withdrawETHfromDEDU").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const wNative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());

  await wNative.withdrawETHBalance("0x68Fe50235230e24f17c90f8Fb0Cd4626fbD34972");
});
