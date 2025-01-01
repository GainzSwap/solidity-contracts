import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { ZeroAddress } from "ethers";

task("createPair", "Creates new pair via admin interaction")
  .addParam("tokenA", "The token address")
  .addParam("amountA", "The initial liquidity amount")
  .addParam("tokenB", "The token address")
  .addParam("amountB", "The initial liquidity amount")
  .setAction(async ({ tokenA, amountA, tokenB, amountB }, hre) => {
    const { ethers } = hre;
    const { deployer } = await hre.getNamedAccounts();
    const router = await ethers.getContract<Router>("Router", deployer);

    const pair = await router.getPair(tokenA, tokenB);

    if (pair != ZeroAddress) {
      throw new Error("Pair already exists");
    }

    amountA = ethers.parseEther(amountA);
    amountB = ethers.parseEther(amountB);

    const wNative = await router.getWrappedNativeToken();
    let value = 0;
    const [paymentA, paymentB] = await Promise.all(
      [
        { token: tokenA, amount: amountA },
        { token: tokenB, amount: amountB },
      ].map(async ({ token: _token, amount }) => {
        const token = await ethers.getContractAt("ERC20", _token);

        if (_token == wNative) {
          value = amount;
        } else {
          await token.approve(router, amount);
        }

        return { token, amount, nonce: 0 };
      }),
    );

    await router.createPair(paymentA, paymentB, { value });
  });
