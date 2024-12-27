import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { getRouterLibraries } from "../utilities";
import { Router } from "../typechain-types";

task("deployNewViews", "").setAction(async (_, hre) => {
  const { ethers } = hre;

  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const routerAddress = await router.getAddress();

  const Views = await ethers.getContractFactory("Views", {
    libraries: {
      AMMLibrary: await (await ethers.deployContract("AMMLibrary")).getAddress(),
    },
  });
  const views = await Views.deploy(routerAddress, await router.getPairsBeacon());
  await views.waitForDeployment();

  const { abi, metadata } = await hre.deployments.getExtendedArtifact("Views");
  await hre.deployments.save("Views", { abi, metadata, address: await views.getAddress() });

  await hre.deployments.run("generateTsAbis");
});
