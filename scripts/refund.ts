import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";

task("refund", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { newOwner, newFeeTo } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", newOwner);
  const governanceAddress = await router.getGovernance();
  const governance = await ethers.getContractAt("Governance", governanceAddress);

  const launchPairAddress = await governance.launchPair();
  const launchPair = await ethers.getContractAt("LaunchPair", launchPairAddress);

  const { fundsRaised } = await launchPair.getCampaignDetails(1);
  const tx = {
    to: launchPair,
    value: fundsRaised,
    gasLimit: 21000,
  };

  const signer = await ethers.getSigner(newOwner);
  await signer.sendTransaction(tx);
});
