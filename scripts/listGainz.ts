import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz } from "../typechain-types";
import { ZeroAddress } from "ethers";

task("listGainz", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const gainzAddress = await gainz.getAddress();

  await hre.run("createPair", {
    tokenA: gainzAddress,
    amountA: "0.5",
    tokenB: ZeroAddress,
    amountB: "1",
  });
});
