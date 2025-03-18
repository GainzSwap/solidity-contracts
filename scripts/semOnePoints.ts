import "@nomicfoundation/hardhat-toolbox";
import axios from "axios";
import { task } from "hardhat/config";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { stringify } from "csv-stringify/sync";
import { getAddress, isAddress } from "ethers";

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

task("semOnePoints", "").setAction(async (_, hre) => {
  const USERS_POINTS_FILE = "usersPoints.json";
  let usersPoints: IUserStatReturnType[] = [];

  // Check if the file exists and load data
  if (existsSync(USERS_POINTS_FILE)) {
    console.log("Loading usersPoints from JSON...");
    usersPoints = JSON.parse(readFileSync(USERS_POINTS_FILE, "utf8"));
  } else {
    console.log("Fetching usersPoints from remote...");
    let page = 1;
    while (
      await axios
        .get<{
          page: number;
          limit: number;
          totalUsers: number;
          totalPages: number;
          results: IUserStatReturnType[];
        }>(`https://gainzswap.xyz/api/leaderboard?page=${page}&limit=100`)
        .then(({ data }) => {
          usersPoints = usersPoints.concat(data.results);
          console.log(`Page ${page} fetched`);
          page++;
          return data.results.length > 0;
        })
        .catch(() => false)
    ) {}

    // Save fetched data to JSON
    writeFileSync(USERS_POINTS_FILE, JSON.stringify(usersPoints, null, 2));
    console.log("UsersPoints saved to JSON.");
  }

  // Remove feeTo
  const feeTo = "0x68Fe50235230e24f17c90f8Fb0Cd4626fbD34972";
  const feeToIndex = usersPoints.findIndex(user => getAddress(user.walletAddress) === getAddress(feeTo));
  feeToIndex >= 0 && usersPoints.splice(feeToIndex, 1);
  console.log({ feeToIndex });
  usersPoints = usersPoints.filter(user => user.userPoint > 0);

  const totalPoints = 10_682_493;
  const teamPoints = 0.1 * totalPoints;
  const communityPoints = totalPoints - teamPoints;

  const diamondYuzuPoints = 0.9 * communityPoints;
  const platinumYuzuPoints = 0.08 * communityPoints;
  const goldYuzuPoints = 0.0155 * communityPoints;
  const silverYuzuPoints = 0.0035 * communityPoints;
  const bronzeYuzuPoints = communityPoints - diamondYuzuPoints - platinumYuzuPoints - goldYuzuPoints - silverYuzuPoints;

  if (bronzeYuzuPoints <= 0) throw "Bad bronze " + bronzeYuzuPoints;

  let group: {
    [key in PointLevels]: {
      Yuzu: number;
      Gainz: number;
      userCount: number;
    };
  } = {
    "Bronze 🥉": { Gainz: 0, userCount: 0, Yuzu: bronzeYuzuPoints },
    "Diamond 💎": { Gainz: 0, userCount: 0, Yuzu: diamondYuzuPoints },
    "Gold 🥇": { Gainz: 0, userCount: 0, Yuzu: goldYuzuPoints },
    "Platinum 🌟": { Gainz: 0, userCount: 0, Yuzu: platinumYuzuPoints },
    "Silver 🥈": { Gainz: 0, userCount: 0, Yuzu: silverYuzuPoints },
  };

  const pointsGainzComm: {
    address: string;
    level: PointLevels;
    levelYuzuPool: number;
    gainzPoints: number;
    Yuzu: number;
  }[] = [];
  const pointsGainzForOC: { address: string; amount: number; reasonCode: string }[] = [];

  usersPoints.forEach(user => {
    if (user.userPoint > 0) {
      group[user.userLevel].userCount++;
      group[user.userLevel].Gainz += user.userPoint;
    }
  });

  let totalYuzuDistributed = 0;
  const addValue = (value: (typeof pointsGainzComm)[number]) => {
    pointsGainzComm.push(value);
    pointsGainzForOC.push({
      address: value.address,
      amount: value.Yuzu,
      reasonCode: "Season0_dapp_gainzswap",
    });
    totalYuzuDistributed += value.Yuzu;
  };
  const addUserPoints = (user: (typeof usersPoints)[number]) => {
    let value: (typeof pointsGainzComm)[number] = {} as any;
    value.address = user.walletAddress;
    value.level = user.userLevel;
    value.gainzPoints = user.userPoint;

    // Base point level
    value.Yuzu = (group[value.level].Yuzu * 0.45) / group[value.level].userCount;
    // Boosted point level
    value.Yuzu += (value.gainzPoints * group[value.level].Yuzu * 0.55) / group[value.level].Gainz;

    addValue(value);
  };

  for (const user of usersPoints) {
    if (user.userPoint <= 0) continue;

    addUserPoints(user);
  }
  addValue({
    address: feeTo,
    gainzPoints: 0,
    level: PointLevels.Bronze,
    levelYuzuPool: 0,
    Yuzu: totalPoints - totalYuzuDistributed,
  });

  // Convert data to CSV format
  const csvGainzComm = stringify(pointsGainzComm, { header: true });
  const csvGainzForOC = stringify(pointsGainzForOC, { header: true });
  const csvUserPoints = stringify(usersPoints, { header: true });

  // Save as CSV files
  writeFileSync("pointsGainzComm.csv", csvGainzComm);
  writeFileSync("pointsGainzForOC.csv", csvGainzForOC);
  writeFileSync("usersPoints.csv", csvUserPoints);

  console.log({ totalYuzuDistributed, totalPoints });
});
