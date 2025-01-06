import { ethers as e } from "hardhat";

export async function getGovernanceLibraries(ethers: typeof e) {
  const OracleLibrary = await (await ethers.deployContract("OracleLibrary")).getAddress();

  const libs = {
    DeployLaunchPair: await (await ethers.deployContract("DeployLaunchPair")).getAddress(),
    GovernanceLib: await (await ethers.deployContract("GovernanceLib", { libraries: { OracleLibrary } })).getAddress(),
    DeployGToken: await (await ethers.deployContract("DeployGToken")).getAddress(),
    OracleLibrary,
  };

  await saveLibraries(libs, "Governance", ethers);

  return libs;
}

export async function getRouterLibraries(
  ethers: typeof e,
  govLibs: Awaited<ReturnType<typeof getGovernanceLibraries>>,
) {
  const AMMLibrary = await (await ethers.deployContract("AMMLibrary")).getAddress();

  const libs = {
    OracleLibrary: govLibs.OracleLibrary,
    DeployWNTV: await (await ethers.deployContract("DeployWNTV")).getAddress(),
    RouterLib: await (await ethers.deployContract("RouterLib", { libraries: { AMMLibrary } })).getAddress(),
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

  await saveLibraries(libs, "Router", ethers);

  return libs;
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

async function saveLibraries(libraries: Record<string, string>, contractName: string, ethers: typeof e) {
  const network = await ethers.provider.getNetwork();
  if (network.name == "hardhat") return;

  const libPath = `verification/libs/${network.name}/${contractName}.js`;

  // Convert the object to a JSON string with indentation for readability
  const jsonString = JSON.stringify(libraries, null, 2);

  // Define the file path where the object will be saved
  const filePath = path.join(__dirname, "../verification/libs/neox/Router.js");

  // Write the JSON string to the file
  fs.writeFile(libPath, `module.exports = ${jsonString};\n`, "utf8", err => {
    if (err) {
      console.error("Error writing file:", err);
    } else {
      console.log("File has been saved.");
    }
  });
}

import { HardhatRuntimeEnvironment } from "hardhat/types";

export async function getDeploymentTxHashFromNetwork(
  hre: HardhatRuntimeEnvironment,
  contractAddress: string,
  startBlock = 0,
) {
  try {
    // Fetch the transaction receipt for the contract creation
    const provider = hre.ethers.provider;
    const code = await provider.getCode(contractAddress);

    if (code === "0x") {
      console.error(`No contract found at address ${contractAddress}`);
      return null;
    }

    // Iterate through blocks to find the deployment transaction
    const latestBlock = await provider.getBlockNumber();
    for (let blockNumber = startBlock; blockNumber <= latestBlock; blockNumber++) {
      const block = await provider.getBlock(blockNumber);

      // Iterate through transactions in the block
      for (const txHash of block?.transactions || []) {
        const tx = await provider.getTransaction(txHash);

        // Deployment transactions have `to` set to null
        if (tx && tx.to === null) {
          const receipt = await provider.getTransactionReceipt(tx.hash);

          if (receipt && receipt.contractAddress === contractAddress) {
            console.log(`Deployment transaction hash found: ${tx.hash}`);

            return receipt;
          }
        }
      }
    }

    console.error(`Deployment transaction not found for contract at ${contractAddress}`);
    return null;
  } catch (error: any) {
    console.error(`Error fetching transaction hash: ${error.message}`);
    return null;
  }
}

export function randomNumber(min: number, max: number) {
  return Math.floor(Math.random() * (max - min) + min);
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
