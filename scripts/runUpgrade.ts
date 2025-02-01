import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";

task("runUpgrade", "Upgrades updated contracts").setAction(async (_, hre) => {
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const router = await hre.ethers.getContract<Router>("Router", deployer);

  const govAddress = await router.getGovernance();
  const governance = await hre.ethers.getContractAt("Governance", govAddress);

  const launchPairAddress = await governance.launchPair();

  console.log("Starting Upgrades");
  await hre.run("compile");

  console.log("Upgrading LaunchPair");
  await hre.upgrades.forceImport(
    launchPairAddress,
    await hre.ethers.getContractFactory("LaunchPair", { signer: deployerSigner }),
  );
  const newLaunchPair = await hre.upgrades.upgradeProxy(
    launchPairAddress,
    await hre.ethers.getContractFactory("LaunchPair", { signer: deployerSigner }),
    {
      redeployImplementation: "always",
    },
  );
  console.log("LaunchPair upgraded successfully.");

  console.log("\nSaving artifacts");
  for (const [contract, address] of [["LaunchPair", launchPairAddress]]) {
    const { abi, metadata } = await hre.deployments.getExtendedArtifact(contract);
    await hre.deployments.save(contract, { abi, metadata, address });
  }

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");
});
