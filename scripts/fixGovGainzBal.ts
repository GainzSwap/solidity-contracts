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

  let amount = 0n;
  try {
    const { tradeTokenPayment } = await governance.pairListing(deployer);
    amount = tradeTokenPayment.amount;
  } catch (error) {}
  amount < 1n && (amount = 3702349199034132347904207n);
  const govbalIsLow = async () => (await gainz.balanceOf(governance)) < amount;

  const signers = await ethers.getSigners();

  while (await govbalIsLow()) {
    const signer = signers.pop();
    if (!signer) break;
    const bal = await gainz.balanceOf(signer);
    if (bal > 0n) {
      await gainz.connect(signer).transfer(governance, bal);
    }
  }

  await governance.updateRewardReserve();
});
