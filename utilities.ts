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
  await saveLibraries({ AMMLibrary }, "AMMLibrary", ethers);

  return { routerLibs: libs, AMMLibrary };
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
  const dir = path.dirname(libPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Convert the object to a JSON string with indentation for readability
  const jsonString = JSON.stringify(libraries, null, 2);

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
import { Router } from "./typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getAddress, getCreate2Address, keccak256, solidityPackedKeccak256, ZeroAddress } from "ethers";

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

export async function getSwapTokens(router: Router, ethers: typeof e) {
  const pairs: { token0: string; token1: string; address: string }[] = [];
  const swapTokens: Set<string> = new Set();

  const joiner = "@";
  const makePair = ([from, to]: [string, string]) => `${from}${joiner}${to}` as const;
  const makePath = (pair: string) => pair.split(joiner);
  const tradePairs: ReturnType<typeof makePair>[] = [];

  for (const address of await router.pairs()) {
    const pair = await ethers.getContractAt("Pair", address);
    const token0 = await pair.token0();
    const token1 = await pair.token1();

    swapTokens.add(token0);
    swapTokens.add(token1);

    pairs.push({ token0, token1, address });

    tradePairs.push(makePair([token0, token1]), makePair([token1, token0]));
  }

  const cachedSwapPaths: { [key: string]: string[] | undefined } = {};

  return {
    swapTokens: Array.from(swapTokens),
    selectTokens: () => {
      const tokens = Array.from(swapTokens);

      return { tokenIn: tokens.splice(getRandomIndex(tokens))[0], tokenOut: tokens.splice(getRandomIndex(tokens))[0] };
    },
    findBestPath([inToken, outToken]: [string, string], depth = 0) {
      if (inToken == outToken) {
        return null;
      }

      const cacheKey = makePair([inToken, outToken]);

      const cachedSwapPath = cachedSwapPaths[cacheKey];
      if (cachedSwapPath) {
        return cachedSwapPath;
      }

      const pathsBuilder: {
        complete: string[];
        fromInBetween: string[][];
        toInBetween: string[][];
      } = { complete: [], fromInBetween: [], toInBetween: [] };

      // inclusivePaths
      for (const pair of tradePairs) {
        if (!(pair.includes(inToken) || pair.includes(outToken))) {
          continue;
        }

        const path = makePath(pair);

        const hasFrom = path[0] === inToken;
        const hasTo = path.at(-1) === outToken;

        if (hasFrom && hasTo) {
          pathsBuilder.complete.push(...path);
        } else if (hasFrom) {
          pathsBuilder.fromInBetween.push(path);
        } else if (hasTo) {
          pathsBuilder.toInBetween.push(path);
        }
      }

      while (pathsBuilder.fromInBetween.length > 0 && depth <= 4) {
        const fromIDxBetween = pathsBuilder.fromInBetween.pop();
        if (fromIDxBetween?.length) {
          const last_fromIDxBetween = fromIDxBetween.at(-1)!;

          for (const toIDxBetween of pathsBuilder.toInBetween) {
            const [first_toIDxBetween] = toIDxBetween;
            if (first_toIDxBetween == last_fromIDxBetween) {
              // Glue them
              pathsBuilder.complete.push(...fromIDxBetween, ...toIDxBetween.slice(1));
            } else {
              // Search for intermediates
              const intermediate_path: [string, string] = [last_fromIDxBetween, first_toIDxBetween];
              pathsBuilder.complete.push(...(this.findBestPath(intermediate_path, depth + 1) || []));
            }
          }
        }
      }

      const swapPaths = pathsBuilder.complete;

      if (swapPaths.length) {
        cachedSwapPaths[cacheKey] = swapPaths;
      }

      return swapPaths;
    },
  };
}

export async function getAmount(account: HardhatEthersSigner, token: string, ethers: typeof e, wnative: string) {
  const isNative = isAddressEqual(token, ZeroAddress) || (isAddressEqual(token, wnative) && randomNumber(0, 100) >= 55);
  const tokenContract = await ethers.getContractAt("ERC20", token);
  const balance = await (isNative ? ethers.provider.getBalance(account) : tokenContract.balanceOf(account));
  const amount =
    balance <= 10_000n ? (balance * 9n) / 10n : BigInt(Math.floor(Math.random() * +balance.toString())) / 10_000n;

  return { amount, isNative };
}

export function computePriceOracleAddr(routerAddress: string) {
  const PriceOralcleBuild = require("./artifacts/contracts/PriceOracle.sol/PriceOracle.json");
  return getCreate2Address(
    routerAddress,
    solidityPackedKeccak256(["address"], [routerAddress]),
    keccak256(PriceOralcleBuild.bytecode),
  );
}

export const getRandomItem = <T = any>(array: T[]) => array[getRandomIndex(array)];
export const getRandomIndex = (array: any[]) => Math.floor((Math.random() * array.length) % array.length);

export const runInErrorBoundry = async (cb: Function, acceptedErrStrings: string[]) => {
  try {
    await cb();
  } catch (error: any) {
    if (!acceptedErrStrings.some(errString => error.toString().includes(errString))) {
      throw error;
    }

    console.log(error);
  }
};

export const isAddressEqual = (a: string, b: string) => getAddress(a) === getAddress(b);
