import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router } from "../typechain-types";
import { formatEther } from "ethers";

task("checkGainz", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);

  const governanceAdr = await router.getGovernance();
  const governance = await hre.ethers.getContractAt("Governance", governanceAdr);

  const stakersGainz = await gainz.stakersGainzToEmit();
  const stakersReserve = await governance.rewardsReserve();
  const rewardPerShare = await governance.rewardPerShare();

  console.log({
    stakersGainz: (+formatEther(stakersGainz)).toLocaleString(),
    stakersReserve: (+formatEther(stakersReserve)).toLocaleString(),
    rewardPerShare,
  });
});
