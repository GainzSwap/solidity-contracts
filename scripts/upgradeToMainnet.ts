import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { getGovernanceLibraries, getRouterLibraries } from "../utilities";
import { Gainz, RouterV2, Views } from "../typechain-types";

import * as fs from "fs";
import * as path from "path";
import { ZeroAddress } from "ethers";

// Function to delete an array of files
function deleteFiles(folderPath: string, fileArray: string[]) {
  fileArray.forEach(fileName => {
    const filePath = path.join(folderPath, fileName);

    // Check if the file exists before attempting to delete it
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, err => {
        if (err) {
          console.error(`Error deleting file: ${filePath}`, err);
        } else {
          console.log(`Deleted file: ${filePath}`);
        }
      });
    } else {
      console.log(`File not found: ${filePath}`);
    }
  });
}

// Function to delete a folder and its contents
function deleteFolder(folderPath: string) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach(file => {
      const filePath = path.join(folderPath, file);
      if (fs.statSync(filePath).isDirectory()) {
        // Recursive call if it's a directory
        deleteFolder(filePath);
      } else {
        // Delete file
        fs.unlinkSync(filePath);
        console.log(`Deleted file: ${filePath}`);
      }
    });
    // Remove the now-empty folder
    fs.rmdirSync(folderPath);
    console.log(`Deleted folder: ${folderPath}`);
  } else {
    console.log(`Folder not found: ${folderPath}`);
  }
}

task("upgradeToMainnet", "").setAction(async (_, hre) => {
  const { ethers } = hre;

  const { deployer } = await hre.getNamedAccounts();
  const routerV2 = await ethers.getContract<RouterV2>("RouterV2", deployer);

  const routerAddress = await routerV2.getAddress();
  const wNtvAddress = await routerV2.getWrappedNativeToken();
  const govAddress = await routerV2.getGovernance();
  const gTokenAddress = await (await ethers.getContractAt("GovernanceV2", govAddress)).getGToken();

  deleteFolder("deployments/" + hre.network.name);

  const routerFactory = async () =>
    ethers.getContractFactory("Router", {
      libraries: await getRouterLibraries(ethers),
    });
  const wNtvFactory = async () => ethers.getContractFactory("WNTV");
  const govFactory = async () =>
    ethers.getContractFactory("Governance", {
      libraries: await getGovernanceLibraries(ethers),
    });
  const gTokenFactory = async () => ethers.getContractFactory("GToken", {});

  await hre.run("compile");

  const routerProxy = await hre.upgrades.forceImport(routerAddress, await routerFactory());
  await hre.upgrades.upgradeProxy(routerProxy, await routerFactory(), {
    unsafeAllow: ["external-library-linking"],
  });

  const router = await ethers.getContractAt("Router", routerAddress);

  await router.setPriceOracle();

  const govProxy = await hre.upgrades.forceImport(govAddress, await govFactory());
  await hre.upgrades.upgradeProxy(govProxy, await govFactory(), {
    unsafeAllow: ["external-library-linking"],
    redeployImplementation: "always",
  });

  const wNtvProxy = await hre.upgrades.forceImport(wNtvAddress, await wNtvFactory());
  await hre.upgrades.upgradeProxy(wNtvProxy, await wNtvFactory(), { redeployImplementation: "always" });

  const gTokenProxy = await hre.upgrades.forceImport(gTokenAddress, await gTokenFactory());
  await hre.upgrades.upgradeProxy(gTokenProxy, await gTokenFactory(), { redeployImplementation: "always" });

  const { save, getExtendedArtifact } = hre.deployments;
  const artifactsToSave = [
    ["GToken", gTokenAddress],
    ["Gainz", await (await ethers.getContract<Gainz>("Gainz", deployer)).getAddress()],
    ["Governance", govAddress],
    ["Pair", ZeroAddress],
    ["Router", routerAddress],
    ["Views", await (await ethers.getContract<Views>("Views", deployer)).getAddress()],
    ["WNTV", wNtvAddress],
  ];

  for (const [contract, address] of artifactsToSave) {
    const { abi, metadata } = await getExtendedArtifact(contract);
    await save(contract, { abi, metadata, address });
  }

  await hre.deployments.run("generateTsAbis");
});
