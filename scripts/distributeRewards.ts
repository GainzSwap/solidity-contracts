import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Governance } from "../typechain-types";
import { parseEther } from "ethers";

task("distributeRewards", "")
  .addParam("amount")
  .setAction(async ({ amount }, hre) => {
    const { deployer } = await hre.getNamedAccounts();
    const gainzToken = await hre.ethers.getContract<Gainz>("Gainz", deployer);
    const governance = await hre.ethers.getContract<Governance>("Governance", deployer);

    await gainzToken.transfer(governance, parseEther(amount));
    await governance.updateRewardReserve();
  });
