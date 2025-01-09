import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz } from "../typechain-types";

task("entityFund", "")
  .addParam("entity", "nae")
  .addParam("to", "")
  .setAction(async ({ entity, to }, hre) => {
    const { deployer } = await hre.getNamedAccounts();
    const gainz = await hre.ethers.getContract<Gainz>("Gainz", deployer);

    await gainz.mintGainz();
    await gainz.sendGainz(to, entity);
  });
