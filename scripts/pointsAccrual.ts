import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { isAddress } from "ethers";

type ActivityRecord = {
  hashNEvent: string;
  walletAddress: string;
  action: {
    version: number;
    title: string;
    data: {
      token: string;
      amount: string;
      direction: string;
      source: string;
    };
  };
  pointsAdded: number;
  pointsRatePerSecond: string;
  createdAt: string;
  pointsPerDay: number;
};

type ActivityResponse = {
  page: number;
  limit: number;
  totalRecords: number;
  totalPages: number;
  result: {
    [date: string]: ActivityRecord[];
  };
};

type WalletStats = {
  totalAccruedPoints: number;
  currentTotalPointsPerDay: number;
  records: {
    action: ActivityRecord["action"]["title"];
    pointsAccrued: number;
  }[];
  date: string;
};

async function fetchActivityPage(walletAddress: string, page: number): Promise<ActivityResponse> {
  const url = `https://www.gainzswap.xyz/api/user/${walletAddress}/activityLog?timezone=Africa/Lagos&page=${page}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch page ${page} for wallet ${walletAddress}`);
  }

  return response.json();
}

export async function computeWalletPoints(walletAddress: string, asOfDate: Date = new Date()): Promise<WalletStats> {
  const asOfTimestamp = Math.floor(asOfDate.getTime() / 1000);
  let page = 1;
  let totalPages = 1;
  let totalAccruedPoints = 0;
  let currentTotalPointsPerDay = 0;
  const records: WalletStats["records"] = [];

  while (page <= totalPages) {
    const data: ActivityResponse = await fetchActivityPage(walletAddress, page);
    totalPages = data.totalPages;

    Object.values(data.result).forEach(_records => {
      for (const record of _records) {
        const createdAt = parseInt(record.createdAt, 10);
        const secondsElapsed = asOfTimestamp - createdAt;

        if (secondsElapsed <= 0) continue;

        const ratePerSecond = parseFloat(record.pointsRatePerSecond);
        const accruedPoints = (ratePerSecond * secondsElapsed) / 10 ** 18;
        if(accruedPoints < 0) continue;

        totalAccruedPoints += accruedPoints;
        currentTotalPointsPerDay += record.pointsPerDay;
        records.push({
          action: record.action.title,
          pointsAccrued: accruedPoints,
        });
      }
    });

    page++;
  }

  return {
    totalAccruedPoints,
    currentTotalPointsPerDay,
    records,
    date: asOfDate.toISOString(),
  };
}

task("pointsAccrual", "")
  .addParam("address")
  .setAction(async ({ address }, hre) => {
    if (isAddress(address) === false) {
      throw new Error("Invalid address provided");
    }

    console.log("Fetching points for address:", address);

    await computeWalletPoints(address, 
      // new Date("2025-04-04T04:20:59Z")
    )
      .then(stats => {
        console.log("Records:");
        console.table(stats.records.reverse(), ["action", "pointsAccrued"]);
        console.log("Date:", stats.date);
        console.log("Total Accrued Points:", stats.totalAccruedPoints);
        console.log("Current Daily Accrual Rate:", stats.currentTotalPointsPerDay);
      })
      .catch(console.error);
  });
