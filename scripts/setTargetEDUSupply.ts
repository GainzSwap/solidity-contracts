import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { parseEther } from "ethers";

task("setTargetEDUSupply")
  .addParam("target")
  .setAction(async ({ target }, hre) => {
    const { ethers } = hre;
    const { deployer } = await hre.getNamedAccounts();
    const router = await ethers.getContract<Router>("Router", deployer);
    const wNative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());

    await wNative.setTargetSupply(parseEther(target));
  });
