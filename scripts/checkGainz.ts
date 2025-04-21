import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router, Views } from "../typechain-types";
import { formatEther } from "ethers";

task("checkGainz", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const views = await ethers.getContract<Views>("Views", deployer);
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
    liq: await views.getLiquidityValue("0x597FFfA69e133Ee9b310bA13734782605C3549b7","0x32eDd6f3453f4b1F7Ad9DC4CEAF3Cff861f1080F", 33),
  });
});
