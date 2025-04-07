import "@nomicfoundation/hardhat-toolbox";
import axios from "axios";
import { task } from "hardhat/config";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { Gainz, Router, Views } from "../typechain-types";
import { formatEther } from "ethers";
import { getSwapTokens, isAddressEqual } from "../utilities";

// 👇 Replace with your actual Blockscout base URL
const BLOCKSCOUT_API = "https://educhain.blockscout.com/api";

const DATA_FILE = "stats/txMetrics.json";
const CONTRACT_ADDRESSES = [
  "0xd35C85FbA82587c15D2fa255180146A046B67237",
  "0x32eDd6f3453f4b1F7Ad9DC4CEAF3Cff861f1080F",
  "0x6ef942D16F120c81B09452Fa7919ed42b6fCa62C",
  "0xC7E2CB9edFA87b39B142866c422e64CC6b2f11d2",
  "0xe9fA511761f1245c7e41B9c7B0317934519d1786",
  "0x04830e6ce86d68357cDB1baD7313a73ABe45E34D",
  "0x597FFfA69e133Ee9b310bA13734782605C3549b7",
].map(a => a.toLowerCase());

async function fetchTxsCount(address: string) {
  const url = `${BLOCKSCOUT_API}/v2/addresses/${address}/counters`;
  const response = await axios.get<{
    transactions_count: string;
    token_transfers_count: string;
    gas_usage_count: string;
    validations_count: string;
  }>(url);

  return response.data;
}

async function fetchTokenCounter(address: string) {
  const url = `${BLOCKSCOUT_API}/v2/tokens/${address}/counters`;
  const response = await axios.get<{
    token_holders_count: string;
    transfers_count: string;
  }>(url);

  return response.data;
}

task("txMetrics", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const views = await ethers.getContract<Views>("Views", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const gtokenAddress = await governance.getGToken();

  const dEDU = await router.getWrappedNativeToken();
  const { pairs, findBestPath } = await getSwapTokens(router, ethers);

  const dEDUContract = await ethers.getContractAt("WNTV", dEDU);

  let totalEDUValue = await dEDUContract.totalSupply();
  for (const pair of pairs) {
    const pairContract = await ethers.getContractAt("Pair", pair);
    const token0 = await pairContract.token0();
    const token1 = await pairContract.token1();

    if (isAddressEqual(token0, dEDU) || isAddressEqual(token1, dEDU)) {
      totalEDUValue += await dEDUContract.balanceOf(pair);
    } else if (isAddressEqual(token1, dEDU)) {
      const pathToDEDU = findBestPath([token0, dEDU]);
      if (!pathToDEDU?.length) continue;
      const [token0Reserve] = await pairContract.getReserves();

      totalEDUValue += await views.getQuote(token0Reserve, pathToDEDU);
    }
  }

  let txMetrics: Record<
    string,
    {
      txCount: number;
    }
  > = {};

  if (existsSync(DATA_FILE)) {
    txMetrics = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  }

  for (const contract of CONTRACT_ADDRESSES) {
    console.log(`\n📦 Scanning contract: ${contract}`);
    if (!txMetrics[contract]) {
      txMetrics[contract] = {
        txCount: 0,
      };
    }

    const { transactions_count } = await fetchTxsCount(contract);
    txMetrics[contract].txCount = parseInt(transactions_count, 10);

    writeFileSync(DATA_FILE, JSON.stringify(txMetrics, null, 2));
  }

  console.log("\n✅ Finished. Current transaction counts:");
  console.table(txMetrics);
  console.log("--------------------------------------------------");
  console.log(
    `Total number of on-chain transactions:: ${Object.values(txMetrics).reduce((acc, { txCount }) => acc + txCount, 0)}`,
  );
  console.log(`Total Value Locked (TVL): ${formatEther(totalEDUValue)} $EDU`);
  console.log("Token Performace:");
  for (const contract of [
    { name: "Delegated EDU", address: dEDU },
    { name: "GToken", address: gtokenAddress },
    { name: "Gainz", address: await gainz.getAddress() },
  ]) {
    const { token_holders_count, transfers_count } = await fetchTokenCounter(contract.address);
    console.log(
      `${contract.name} (${contract.address}) - Token Holders: ${token_holders_count}, Transfers: ${transfers_count}`,
    );
  }
});
