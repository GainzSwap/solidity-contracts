# GainzSwap Smart Contracts 🦾

GainzSwap is a next-gen decentralised trading and staking platform built for the EDU Chain ecosystem. It empowers users to earn **real yields** via liquidity provision and delegated EDU staking, while supporting a full trading lifecycle with governance and token launch tools.

This repo contains all the core smart contracts and deployment scripts powering the GainzSwap protocol.

---

## 🚀 Features

- Automated Market Maker (AMM) with liquidity pools
- Liquidity staking to earn $GAINZ and points
- Delegated EDU staking via `dEDU` mechanism
- Governance-driven token listing and voting
- LaunchPair mechanism for governance controlled new pool creation
- Oracle-powered price feeds for fair execution
- Integrated GainzPoints system for gamified rewards

---

## 🛠 Tech Stack

- **Solidity**
- **TypeScript** (deployment + scripts)
- **Hardhat** for local development
- **OpenZeppelin Contracts** for standards and utilities

---

## 📁 Project Structure

```text
contracts/
├── Governance.sol           # Governance and proposal voting
├── LaunchPair.sol           # Controlled creation of new token pairs
├── Pair.sol                 # Core AMM pool contract
├── PriceOracle.sol          # Median-based price oracle
├── Router.sol               # Router for adding/removing liquidity and swaps
├── Views.sol                # Read-only views for UI or integrations
├── abstracts/               # Abstract base contracts
├── interfaces/              # External contract interfaces
├── libraries/               # Utility libraries
├── tokens/                  # ERC20 token implementations, including GAINZ and dEDU
├── errors.sol               # Custom error definitions
├── types.sol                # Type definitions

deploy/
├── 00_deployContracts.ts    # Main deployment script
├── 02_save_artifacts.ts     # Saves ABI + contract addresses
├── 99_generateTsAbis.ts     # Generates TypeScript typings from ABIs

scripts/
├── createPair.ts            # Script to create new liquidity pairs
├── deployERC20.ts           # Deploy custom ERC20 tokens
├── pointsAccrual.ts         # Script to test points logic
├── moveTime.ts              # Helper for time manipulation
├── reBalancePool.ts         # Liquidity rebalancing
├── unStake.ts               # Unstaking flow
├── ... (many more utils for testing + admin ops)
```

---

## 🧪 Getting Started

### 📦 Install Dependencies

```bash
yarn install
```

### 🔨 Compile Contracts

```bash
npx hardhat compile
```

### 🚀 Deploy Contracts (Local/Testnet)

```bash
npx hardhat run deploy/00_deployContracts.ts --network <network-name>
```

### 🧼 Clean Build

```bash
npx hardhat clean
```

---

## 💰 Yields on GainzSwap

GainzSwap introduces two powerful ways to earn yield in the EDU Chain ecosystem:

### 1. **Liquidity Staking**
- Provide liquidity to any pair
- Stake your LP tokens in the platform
- Earn: 
  - Swap fees
  - $GAINZ tokens
  - GainzPoints (used for airdrops, leaderboard rankings, and perks)

### 2. **Delegated EDU Staking (dEDU)**
- Deposit EDU → Receive `dEDU`
- dEDU represents your staked EDU and accrues value over time
- Earn:
  - Staking rewards
  - GainzPoints
  - Governance rights (upcoming)

These yield strategies are live on the mainnet and fully integrated into the GainzSwap leaderboard and rewards system.

> **Try it now:**  
> 🔗 [https://gainzswap.xyz](https://gainzswap.xyz)

---

## 📜 License

MIT License © GainzSwap — feel free to fork, contribute, and build upon it.  
Let’s build a more yield-driven DeFi world together.

---

---

## 🌐 Links

- Website: [https://gainzswap.xyz](https://gainzswap.xyz)  
- Telegram: [t.me/GainzSwap](https://t.me/GainzSwap)  
- X (Twitter): [x.com/GainzSwap](https://x.com/GainzSwap)  

---
