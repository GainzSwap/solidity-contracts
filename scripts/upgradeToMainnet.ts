import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { getGovernanceLibraries, getRouterLibraries } from "../utilities";
import { Router } from "../typechain-types";

task("upgradeToMainnet", "").setAction(async (_, hre) => {
  const { ethers } = hre;

  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);

  const routerFactory = async () =>
    ethers.getContractFactory("Router", {
      libraries: await getRouterLibraries(ethers),
    });
  const wNtvFactory = async () => ethers.getContractFactory("WNTV");
  const govFactory = async () =>
    ethers.getContractFactory("Governance", {
      libraries: await getGovernanceLibraries(ethers),
    });

  await hre.run("compile");

  const routerAddress = await router.getAddress();
  const routerProxy = await hre.upgrades.forceImport(routerAddress, await routerFactory());
  await hre.upgrades.upgradeProxy(routerProxy, await routerFactory(), {
    unsafeAllow: ["external-library-linking"],
  });
  await routerProxy.setPriceOracle();

  const govAddress = await router.getGovernance();
  const govProxy = await hre.upgrades.forceImport(govAddress, await govFactory());
  await hre.upgrades.upgradeProxy(govProxy, await govFactory(), {
    unsafeAllow: ["external-library-linking"],
  });

  const wNtvAddress = await router.getWrappedNativeToken();
  const wNtvProxy = await hre.upgrades.forceImport(wNtvAddress, await wNtvFactory());
  await hre.upgrades.upgradeProxy(wNtvProxy, await wNtvFactory());

  const { save, getExtendedArtifact } = hre.deployments;
  const artifactsToSave = [
    ["Router", routerAddress],
    ["Governance", govAddress],
    ["WNTV", wNtvAddress],
  ];

  for (const [contract, address] of artifactsToSave) {
    const { abi, metadata } = await getExtendedArtifact(contract);
    await save(contract, { abi, metadata, address });
  }

  await hre.deployments.run("generateTsAbis");
});
