import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz } from "../typechain-types";
import { ZeroAddress } from "ethers";

task("createInitialPairs", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const gainzAddress = await gainz.getAddress();

  await hre.run("createPair", {
    tokenA: gainzAddress,
    amountA: "533.33333",
    tokenB: ZeroAddress,
    amountB: "1000",
  });
});
