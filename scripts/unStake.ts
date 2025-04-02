import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router, Views } from "../typechain-types";

task("unStake").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const router = await ethers.getContract<Router>("Router", deployer);
  const views = await ethers.getContract<Views>("Views", deployer);
  const goveAddr = await ethers.getContractAt("WNTV", await router.getGovernance());
  const governance = await ethers.getContractAt("Governance", goveAddr);
  const gToken = await ethers.getContractAt("GToken", await governance.getGToken());

  const balances = await gToken.getGTokenBalance(deployer);
  for (const {
    nonce,
    attributes: {
      lpDetails: { token0, token1, liquidity },
    },
  } of balances) {
    const [amt0Min, amt1Min] = await views
      .getLiquidityValue(token0, token1, liquidity)
      .then(amounts => amounts.map(amt => (amt * 98n) / 100n));

    const { hash } = await governance.unStake(nonce, amt0Min, amt1Min);
    console.log({ hash, nonce, amt0Min, amt1Min });
  }
});
