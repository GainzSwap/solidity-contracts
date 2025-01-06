import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { getGovernanceLibraries, getRouterLibraries } from "../utilities";
import { Gainz, Router } from "../typechain-types";

task("upgradeGovernance", "").setAction(async (_, hre) => {
  const { ethers } = hre;

  const govLib = await getGovernanceLibraries(ethers);
  const routerLibs = await getRouterLibraries(ethers, govLib);

  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);

  const routerAddress = await router.getAddress();
  const governanceAddress = await router.getGovernance();
  const gainzAddress = await gainz.getAddress();

  const routerFactory = async () =>
    ethers.getContractFactory("Router", {
      libraries: routerLibs,
    });
  const governanceFactory = async () =>
    ethers.getContractFactory("Governance", {
      libraries: govLib,
    });
  const gainzFactory = async () =>
    ethers.getContractFactory("Gainz", {
      libraries: govLib,
    });

  await hre.run("compile");

  console.log("Upgrading Router");
  const routerProxy = await hre.upgrades.forceImport(routerAddress, await routerFactory());
  await hre.upgrades.upgradeProxy(routerProxy, await routerFactory(), {
    unsafeAllow: ["external-library-linking"],
  });

  console.log("Upgrading Governance");
  const governanceProxy = await hre.upgrades.forceImport(governanceAddress, await governanceFactory());
  await hre.upgrades.upgradeProxy(governanceProxy, await governanceFactory(), {
    unsafeAllow: ["external-library-linking"],
  });

  console.log("Upgrading Gainz");
  const gainProxy = await hre.upgrades.forceImport(gainzAddress, await gainzFactory());
  await hre.upgrades.upgradeProxy(gainProxy, await gainzFactory(), {
    unsafeAllow: ["external-library-linking"],
  });
  await gainz.setInitData(governanceAddress);

  console.log("Saving artifacts");
  const { save, getExtendedArtifact } = hre.deployments;

  const artifactsToSave = [
    ["Router", routerAddress],
    ["Governance", governanceAddress],
    ["Gainz", gainzAddress],
  ];

  for (const [contract, address] of artifactsToSave) {
    const { abi, metadata } = await getExtendedArtifact(contract);
    await save(contract, { abi, metadata, address });
  }

  await hre.deployments.run("generateTsAbis");
});
