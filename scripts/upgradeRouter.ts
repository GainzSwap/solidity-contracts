import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { getRouterLibraries } from "../utilities";
import { Router } from "../typechain-types";

task("upgradeRouter", "").setAction(async (_, hre) => {
  const { ethers } = hre;

  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const routerAddress = await router.getAddress();
  const routerFactory = async () =>
    ethers.getContractFactory("Router", {
      libraries: await getRouterLibraries(ethers),
    });

  const routerProxy = await hre.upgrades.forceImport(routerAddress, await routerFactory());

  await hre.run("compile");
  await hre.upgrades.upgradeProxy(routerProxy, await routerFactory(), {
    unsafeAllow: ["external-library-linking"],
  });

  const { abi, metadata } = await hre.deployments.getExtendedArtifact("Router");
  await hre.deployments.save("Router", { abi, metadata, address: routerAddress });

  const { save, getExtendedArtifact } = hre.deployments;

  const artifactsToSave = [
    ["Router", routerAddress],
    ["WNTV", await router.getWrappedNativeToken()],
  ];

  for (const [contract, address] of artifactsToSave) {
    const { abi, metadata } = await getExtendedArtifact(contract);
    await save(contract, { abi, metadata, address });
  }

  await hre.deployments.run("generateTsAbis");
});
