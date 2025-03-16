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

    if (balance < fundsRaised) throw "Insufficeint Balance";

    await signer.sendTransaction(tx);
  });
