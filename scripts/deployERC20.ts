import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import dotenv from "dotenv";
import { randomNumber } from "../utilities";

dotenv.config();

task("deployERC20", "")
  .addParam("name", "name")
  .addParam("symbol", "The ticker symbol")
  .setAction(async ({ name, symbol }, hre) => {
    const factory = await hre.ethers.getContractFactory("TestERC20");

    const token = await factory.deploy(name, symbol, 18);
    await token.waitForDeployment();

    console.log("new token addr: ", await token.getAddress(), await token.symbol(), await token.name());
    const testers = await hre.getUnnamedAccounts();

    for (const tester of testers) {
      await token.mint(tester, hre.ethers.parseEther(randomNumber(50_000, 3_000_000).toFixed(15)));
    }
  });
