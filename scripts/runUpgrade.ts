import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { getGovernanceLibraries, getRouterLibraries } from "../utilities";

task("runUpgrade", "Upgrades updated contracts").setAction(async (_, hre) => {
  const { deployer } = await hre.getNamedAccounts();
  const router = await hre.ethers.getContract<Router>("Router", deployer);
  const routerAddress = await router.getAddress();
  const govAddress = await router.getGovernance();

  console.log("Starting Upgrades");
  await hre.run("compile");

  console.log("Deploying Libraries");
  const govLibs = await getGovernanceLibraries(hre.ethers);
  const routerLibs = await getRouterLibraries(hre.ethers, govLibs);

  console.log("Upgrading Router");
  await hre.upgrades.upgradeProxy(
    routerAddress,
    await hre.ethers.getContractFactory("Router", { libraries: routerLibs }),
    { redeployImplementation: "always", unsafeAllowLinkedLibraries: true },
  );
  console.log("Router upgraded successfully.");

  console.log("Upgrading Governance");
  await hre.upgrades.forceImport(govAddress, await hre.ethers.getContractFactory("Governance", { libraries: govLibs }));
  await hre.upgrades.upgradeProxy(
    govAddress,
    await hre.ethers.getContractFactory("Governance", { libraries: govLibs }),
    { redeployImplementation: "always", unsafeAllowLinkedLibraries: true },
  );
  console.log("Governance upgraded successfully.");

  console.log("\nSaving artifacts");
  for (const [contract, address] of [
    ["Router", routerAddress],
    ["Governance", govAddress],
  ]) {
    const { abi, metadata } = await hre.deployments.getExtendedArtifact(contract);
    await hre.deployments.save(contract, { abi, metadata, address });
  }

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");
});
