import { ethers as e } from "hardhat";
import { parseEther as _parseEther } from "ethers";

export async function getGovernanceLibraries(ethers: typeof e) {
  return {
    DeployGToken: await (await ethers.deployContract("DeployGToken")).getAddress(),
    OracleLibrary: await (await ethers.deployContract("OracleLibrary")).getAddress(),
  };
}

export async function getRouterLibraries(ethers: typeof e) {
  const govLibs = await getGovernanceLibraries(ethers);
  const AMMLibrary = await (await ethers.deployContract("AMMLibrary")).getAddress();

  return {
    OracleLibrary: govLibs.OracleLibrary,
    DeployWNTV: await (await ethers.deployContract("DeployWNTV")).getAddress(),
    RouterLib: await (await ethers.deployContract("RouterLib", { libraries: { AMMLibrary } })).getAddress(),
    AMMLibrary,
    UserModuleLib: await (await ethers.deployContract("UserModuleLib")).getAddress(),
    DeployPriceOracle: await (await ethers.deployContract("DeployPriceOracle")).getAddress(),
    DeployGovernance: await (
      await (
        await ethers.getContractFactory("DeployGovernance", {
          libraries: govLibs,
        })
      ).deploy()
    ).getAddress(),
  };
}

import * as fs from "fs";
import * as path from "path";

export async function copyFilesRecursively(src: string, dest: string): Promise<void> {
  // src = path.join(__dirname, src);
  // dest = path.join(__dirname, dest);

  // Create the destination folder if it doesn't exist
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  // Read the contents of the source folder
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      // Recursively copy subdirectory
      await copyFilesRecursively(srcPath, destPath);
    } else if (entry.isFile()) {
      // Copy file
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export const parseEther = (ether: string) => _parseEther(ether.replace(/,/g, ""));
