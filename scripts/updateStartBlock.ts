import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router } from "../typechain-types";
import { getDeploymentTxHashFromNetwork } from "../utilities";

task("updateStartBlock", "")
  .addParam("startBlock", undefined, "0")
  .setAction(async ({ startBlock }, hre) => {
    const { ethers } = hre;
    const { deployer } = await hre.getNamedAccounts();

    const router = await ethers.getContract<Router>("Router", deployer);
    const routerAddress = await router.getAddress();
    const blockNumber = (await getDeploymentTxHashFromNetwork(hre, routerAddress, Number(startBlock)))?.blockNumber;
    if (blockNumber == undefined) {
      throw new Error("Deployment block not found");
    }

    const gainz = await ethers.getContract<Gainz>("Gainz", deployer);

    const governanceAdr = await router.getGovernance();
    const governance = await hre.ethers.getContractAt("Governance", governanceAdr);
    const gTokenAddr = await governance.getGToken();

    const artifactsToSave = [
      ["Gainz", await gainz.getAddress()],
      ["Governance", governanceAdr],
      ["GToken", gTokenAddr],
      ["Router", routerAddress],
    ];

    const { save, getExtendedArtifact } = hre.deployments;
    for (const [contract, address] of artifactsToSave) {
      const { abi, metadata } = await getExtendedArtifact(contract);

      await save(contract, {
        abi,
        metadata,
        address,
        receipt: { blockNumber } as any,
      });
    }

    await hre.deployments.run("generateTsAbis");
  });
