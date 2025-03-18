import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router } from "../typechain-types";

task("fixGovGainzBal", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const governanceAddress = await router.getGovernance();
  const governance = await ethers.getContractAt("Governance", governanceAddress);

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);

  const { tradeTokenPayment } = await governance.pairListing(deployer);
  const govbalIsLow = async () => (await gainz.balanceOf(governance)) < tradeTokenPayment.amount;

  const signers = await ethers.getSigners();

  while (await govbalIsLow()) {
    const signer = signers.pop()!;
    const bal = await gainz.balanceOf(signer);
    if (bal > 0n) {
      await gainz.connect(signer).transfer(governance, bal);
    }
  }
});
