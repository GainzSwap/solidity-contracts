import * as dotenv from "dotenv";
dotenv.config();
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-foundry";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@nomicfoundation/hardhat-verify";
import "hardhat-deploy";
import "hardhat-deploy-ethers";
import "@openzeppelin/hardhat-upgrades";

import "./scripts/createInitialPairs";
import "./scripts/moveTime";
import "./scripts/checkGainz";
import "./scripts/upgradePairs";
import "./scripts/e2e";
import "./scripts/deployNewViews";
import "./scripts/deployERC20";
import "./scripts/createPair";
import "./scripts/runUpgrade";
import "./scripts/entityFund";
import "./scripts/createHDWallet";
import "./scripts/settleWithdrawals";
import "./scripts/reBalancePool";
import "./scripts/semOnePoints";
import "./scripts/createERC20";
import "./scripts/listGainz";
import "./scripts/removeLiqFees";
import "./scripts/unStake";
import "./scripts/txMetrics";
import "./scripts/pointsAccrual";

// If not set, it uses the hardhat account 0 private key.
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY!;
const newOwnerPrivateKey = process.env.NEW_OWNER_PRIVATE_KEY!;
const newFeeToPrivateKey = process.env.NEW_FEE_TO_PRIVATE_KEY!;

// If not set, it uses ours Etherscan default API key.
const etherscanApiKey = process.env.ETHERSCAN_API_KEY || "DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        // https://docs.soliditylang.org/en/latest/using-the-compiler.html#optimizer-options
        runs: 150,
      },
    },
  },
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: 0,
    newOwner: 1,
    newFeeTo: 2,
  },
  networks: {
    // View the networks that are pre-configured.
    // If the network you are looking for is not here you can add new network settings
    hardhat: {
      mining: { auto: true, interval: 12_000 },
      accounts: { accountsBalance: "50000000000000000000000000", count: 30 },
    },
    "edu-testnet": {
      url: "https://rpc.open-campus-codex.gelato.digital",
      accounts: [deployerPrivateKey, newOwnerPrivateKey, newFeeToPrivateKey],
    },
    "neox-t4": {
      url: "https://neoxt4seed1.ngd.network",
      accounts: [deployerPrivateKey],
      gasPrice: 40000000000,
    },
    neox: {
      url: "https://mainnet-1.rpc.banelabs.org",
      accounts: [deployerPrivateKey],
      gasPrice: 40e9,
    },
    educhain: {
      url: process.env.EDUCHAIN_RPC,
      accounts: [deployerPrivateKey, newOwnerPrivateKey, newFeeToPrivateKey],
    },
  },
  // configuration for harhdat-verify plugin
  etherscan: {
    apiKey: { opencampus: "NOT NEEDED", neox: "empty", educhain: "empty" },
    customChains: [
      {
        network: "opencampus",
        chainId: 656476,
        urls: {
          apiURL: "https://edu-chain-testnet.blockscout.com/api",
          browserURL: "https://edu-chain-testnet.blockscout.com",
        },
      },
      {
        network: "educhain",
        chainId: 41923,
        urls: {
          apiURL: "https://educhain.blockscout.com/api",
          browserURL: "https://educhain.blockscout.com",
        },
      },
      {
        network: "neox",
        chainId: 47763,
        urls: {
          apiURL: "https://xexplorer.neo.org/api",
          browserURL: "https://xexplorer.neo.org",
        },
      },
    ],
  },
  // configuration for etherscan-verify from hardhat-deploy plugin
  verify: {
    etherscan: {
      apiKey: `${etherscanApiKey}`,
    },
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
