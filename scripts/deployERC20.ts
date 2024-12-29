import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import dotenv from "dotenv";

dotenv.config();

task("deployERC20", "")
  .addParam("name", "name")
  .addParam("symbol", "The ticker symbol")
  .addParam("ownermint", "")
  .setAction(async ({ name, symbol, ownermint }, hre) => {
    const { deployer } = await hre.getNamedAccounts();
    const factory = await hre.ethers.getContractFactory("TestERC20");

    const token = await factory.deploy(name, symbol, 18);
    await token.waitForDeployment();

    await token.mint(deployer, hre.ethers.parseEther(ownermint));

    console.log("new token addr: ", await token.getAddress(), await token.symbol(), await token.name());
    const testers = process.env.TESTERS?.split(",") ?? [];

    for (const tester of testers) {
      await token.mint(
        tester,
        hre.ethers.parseEther(
          (Math.random() * 3_000_000)
            .toString()
            .split(".")
            .reduce((s, c, i) => {
              if (i == 0) {
                return s;
              }

              s += "." + c.substring(0, 15);

              return s;
            }, ""),
        ),
      );
    }
  });
