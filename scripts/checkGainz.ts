import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router } from "../typechain-types";
import { existsSync, readFileSync, writeFileSync } from "fs";

enum PointLevels {
  Bronze = "Bronze 🥉",
  Silver = "Silver 🥈",
  Gold = "Gold 🥇",
  Platinum = "Platinum 🌟",
  Diamond = "Diamond 💎",
}
interface IUserStatReturnType {
  userPoint: number;
  userLevel: PointLevels;
  userLevelPosition: number;
  userLevelRange: number;
  userPosition: number;
  walletAddress: string;
}
const USERS_POINTS_FILE = "usersPoints.json";

task("checkGainz", "").setAction(async (_, hre) => {
  const usersPoints: IUserStatReturnType[] = JSON.parse(readFileSync(USERS_POINTS_FILE, "utf8"));
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);

  const governanceAdr = await router.getGovernance();
  const governance = await hre.ethers.getContractAt("Governance", governanceAdr);

  const stakersGainz = await gainz.stakersGainzToEmit();
  const stakersReserve = await governance.rewardsReserve();
  const rewardPerShare = await governance.rewardPerShare();

  console.log({ stakersGainz, stakersReserve, rewardPerShare });
});
