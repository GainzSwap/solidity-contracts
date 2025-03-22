import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";

task("refund", "")
  .addParam("id")
  .setAction(async ({ id }, hre) => {
    const { ethers } = hre;
    const { deployer, newFeeTo } = await hre.getNamedAccounts();

    const router = await ethers.getContract<Router>("Router", deployer);
    const governanceAddress = await router.getGovernance();
    const governance = await ethers.getContractAt("Governance", governanceAddress);

    const launchPairAddress = await governance.launchPair();
    const launchPair = await ethers.getContractAt("LaunchPair", launchPairAddress);

    const { fundsRaised } = await launchPair.getCampaignDetails(BigInt(id));

    const tx = {
      to: launchPair,
      value: fundsRaised,
    };

    const signer = await ethers.getSigner(newFeeTo);
    const balance = await signer.provider.getBalance(signer);

    if (balance < fundsRaised && hre.network.name !== "localhost") {
      const WEDU = "0xd02E8c38a8E3db71f8b2ae30B8186d7874934e12";
      const wedu = await ethers.getContractAt("WNTV", WEDU);
      await wedu.connect(signer).withdraw(fundsRaised);
    }

    await signer.sendTransaction(tx);
  });
