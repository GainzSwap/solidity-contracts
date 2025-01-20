import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";

task("createHDWallet", "")
  .addParam("feeTo")
  .addParam("newOwner")
  .setAction(async ({ feeTo, newOwner }, hre) => {
    const ethers = hre.ethers;

    const wallet = ethers.Wallet.createRandom();

    console.log("mnemonic", wallet.mnemonic);

    const owner = wallet.deriveChild(Number(newOwner));
    const feeToSetter = wallet.deriveChild(Number(feeTo));

    console.log("FeeTo:", feeToSetter.address, feeToSetter.privateKey);
    console.log("NewOwner:", owner.address, owner.privateKey);
  });
