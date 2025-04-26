import { ethers as e } from "hardhat";

export async function getGovernanceLibraries(ethers: typeof e) {
  const OracleLibrary = await (await ethers.deployContract("OracleLibrary")).getAddress();

  const libs = {
    DeployLaunchPair: await (
      await ethers.deployContract("DeployLaunchPair", { libraries: { OracleLibrary } })
    ).getAddress(),
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
  // const pairs: { token0: string; token1: string; address: string }[] = [];
  const swapTokens: Set<string> = new Set();

  const joiner = "@";
  const makePair = ([from, to]: [string, string]) => `${from}${joiner}${to}` as const;
  const makePath = (pair: string) => pair.split(joiner);
  const tradePairs: ReturnType<typeof makePair>[] = [];

  const pairs = await router.pairs();

  for (const address of pairs) {
    const pair = await ethers.getContractAt("Pair", address);
    const token0 = await pair.token0();
    const token1 = await pair.token1();

    swapTokens.add(token0);
    swapTokens.add(token1);

    // pairs.push({ token0, token1, address });
    tradePairs.push(makePair([token0, token1]));
  }

  // const cachedSwapPaths: { [key: string]: string[] | undefined } = {};

  function findBestPath([inToken, outToken]: [string, string]) {
    if (isAddressEqual(inToken, outToken)) return [inToken];

    // Build adjacency list for graph representation
    const graph: Record<string, string[]> = {};

    for (const pair of tradePairs) {
      const [tokenA, tokenB] = makePath(pair);

      if (!graph[tokenA]) graph[tokenA] = [];
      if (!graph[tokenB]) graph[tokenB] = [];

      graph[tokenA].push(tokenB);
      graph[tokenB].push(tokenA);
    }

    // Perform BFS to find the shortest path
    const queue: [string, string[]][] = [[inToken, [inToken]]];
    const visited = new Set<string>([inToken]);

    while (queue.length > 0) {
      const [currentToken, path] = queue.shift()!;

      if (currentToken === outToken) return path; // Found path

      for (const neighbor of graph[currentToken] || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([neighbor, [...path, neighbor]]);
        }
      }
    }

    return null; // No valid path found
  }

  return {
    pairs,
    swapTokens: Array.from(swapTokens),
    tradePairs,
    makePair,
    makePath,
    selectTokens: () => {
      const tokens = shuffleArray(Array.from(swapTokens));

      if (tokens.length < 2) {
        throw new Error("Not enough tokens to select tokenIn and tokenOut");
      }

      const index1 = getRandomIndex(tokens);
      const tokenIn = tokens[index1];

      tokens.splice(index1, 1); // Remove selected token

      const index2 = getRandomIndex(tokens);
      const tokenOut = tokens[index2];

      return { tokenIn, tokenOut };
    },
    findBestPath,
  };
}

export async function getAmount(account: HardhatEthersSigner, token: string, ethers: typeof e, wNative: string) {
  const isNative = isAddressEqual(token, ZeroAddress) || (isAddressEqual(token, wNative) && randomNumber(0, 100) >= 55);
  let decimals = 18n;

  const balance = isNative
    ? await ethers.provider.getBalance(account)
    : await (async () => {
        const tokenContract = await ethers.getContractAt("ERC20", token);
        const balance = await tokenContract.balanceOf(account.address);
        decimals = await tokenContract.decimals();
        return balance;
      })();

  let amount = BigInt(randomNumber(1e15, 100e18));
  if (amount > balance) {
    amount = (balance * 9n) / 10n; // Use 90% of balance if small
  }

  return { amount, isNative, balance, decimals };
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
export const getRandomIndex = (array: any[]) => Math.floor(Math.random() * array.length);

export const runInErrorBoundry = async (cb: Function, acceptedErrStrings: string[]) => {
  try {
    await cb();
  } catch (error: any) {
    if (!acceptedErrStrings.some(errString => error.toString().includes(errString))) {
      throw error;
    }

    console.log(cb.name, "Failed");
  }
};

export const isAddressEqual = (a: string, b: string) => getAddress(a) === getAddress(b);

/**
 * Shuffles an array in place using the Fisher–Yates algorithm.
 * @param array - The array to shuffle.
 * @returns The shuffled array.
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]; // Optional: copy to avoid mutating original
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const sequentialAccounts: Record<string, boolean> = {};
export function sequentialRun(account: HardhatEthersSigner, cb: (account: HardhatEthersSigner) => Promise<void>) {
  return new Promise<void>(async resolve => {
    const address = account.address;

    console.log("Waiting for account", address, cb.name);
    while (sequentialAccounts[address]) {
      await sleep(1000);
    }

    sequentialAccounts[address] = true;
    try {
      await cb(account);
    } catch (error) {
      console.error("Error in sequentialRun:", error);
    } finally {
      sequentialAccounts[address] = false;
    }

    console.log("Finished sequentialRun", address, cb.name);

    resolve();
  });
}

function extendArray<T>(baseArray: T[], targetLength: number): T[] {
  const extended = [...baseArray];
  while (extended.length < targetLength) {
    extended.push(getRandomItem(baseArray));
  }
  return extended;
}
