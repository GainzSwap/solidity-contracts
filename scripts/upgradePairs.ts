import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { ZeroAddress } from "ethers";

task("upgradePairs", "Upgrades all pairs, remember to edit script with new factories").setAction(async (_, hre) => {
  await hre.run("compile");

  const { deployer } = await hre.getNamedAccounts();
  const router = await hre.ethers.getContract<Router>("Router", deployer);

  const pairBeaconAddress = await router.getPairsBeacon();
  
  // Get contract factories for the new implementations
  const pairFactory = () => hre.ethers.getContractFactory("Pair");

  console.log("Force importing Pair beacon...");
  const pairBeacon = await hre.upgrades.forceImport(pairBeaconAddress, await pairFactory());


  // Upgrade the Beacon with the new implementation of Pair
  console.log("Upgrading Pair beacon...");
  await hre.upgrades.upgradeBeacon(pairBeacon, await pairFactory(), { redeployImplementation: "always" });
  console.log("Pair beacon upgraded successfully.");

  console.log("\nSaving Pair artifacts");
  // Optionally save the new ABI and metadata for the upgraded contract
  const { abi, metadata } = await hre.deployments.getExtendedArtifact("Pair");
  await hre.deployments.save("Pair", { abi, metadata, address: ZeroAddress });

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");


});
