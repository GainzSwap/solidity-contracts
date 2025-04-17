import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";

task("runUpgrade", "Upgrades updated contracts").setAction(async (_, hre) => {
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const router = await hre.ethers.getContract<Router>("Router", deployer);

  const wntvAddr = await router.getWrappedNativeToken();

  console.log("Starting Upgrades");
  await hre.run("compile");

  // WNTV
  console.log("Upgrading WNTV");
  await hre.upgrades.forceImport(wntvAddr, await hre.ethers.getContractFactory("WNTV", { signer: deployerSigner }));
  const newWntv = await hre.upgrades.upgradeProxy(
    wntvAddr,
    await hre.ethers.getContractFactory("WNTV", { signer: deployerSigner }),
    {
      redeployImplementation: "always",
    },
  );
  console.log("WNTV upgraded successfully.");

  console.log("\nSaving artifacts");
  for (const [contract, address] of [["WNTV", wntvAddr]]) {
    const { abi, metadata } = await hre.deployments.getExtendedArtifact(contract);
    await hre.deployments.save(contract, { abi, metadata, address });
  }

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");
});
