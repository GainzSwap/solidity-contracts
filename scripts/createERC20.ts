import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import dotenv from "dotenv";
import { randomNumber } from "../utilities";
import { HardhatRuntimeEnvironment } from "hardhat/types";

dotenv.config();

task("createERC20", "")
  .addParam("name", "name")
  .addParam("decimals", "decimals")
  .addParam("symbol", "The ticker symbol")
  .setAction(async ({ name, symbol, decimals }, hre) => {
    await createERC20({ name, symbol, decimals }, hre);
  });

export interface CreateERC20Type {
  name: string;
  symbol: string;
  decimals: string;
}
export async function createERC20({ name, symbol, decimals }: CreateERC20Type, hre: HardhatRuntimeEnvironment) {
  if (hre.network.name !== "localhost") throw "This deploys only TestERC20";

  const factory = await hre.ethers.getContractFactory("TestERC20");

  const token = await factory.deploy(name, symbol, decimals);
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  const tokenSymbol = await token.symbol();
  const tokenName = await token.name();

  console.log("new token addr: ", tokenAddress, tokenSymbol, tokenName);
  const testers = await hre.getUnnamedAccounts();

  for (const tester of testers) {
    await token.mint(tester, hre.ethers.parseEther(randomNumber(50_000, 3_000_000).toFixed(15)));
  }

  return { tokenAddress, tokenName, tokenSymbol, token };
}
