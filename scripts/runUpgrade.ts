import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";

task("runUpgrade", "Upgrades updated contracts").setAction(async (_, hre) => {
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const router = await hre.ethers.getContract<Router>("Router", deployer);
  const govAddress = await router.getGovernance();

  await hre.run("compile");

  console.log("Starting Upgrades");

  const govLibs = {
    DeployLaunchPair: "0x9040A72f154b5Ed9FbB289733e9f2e4d9660fe48",
    GovernanceLib: "0xaE3fFE7CE50BCd53822ba75429f67a62265174d1",
    DeployGToken: "0x12623F917DA839519f59072497379C0e7Ce89792",
    OracleLibrary: "0x3CabfB0485D0e865452dc4A1A4f812B5513c636C",
  };

  // Governance
  console.log("Upgrading Governance");
  await hre.upgrades.forceImport(
    govAddress,
    await hre.ethers.getContractFactory("Governance", { libraries: govLibs, signer: deployerSigner }),
  );
  await hre.upgrades.upgradeProxy(
    govAddress,
    await hre.ethers.getContractFactory("Governance", { libraries: govLibs, signer: deployerSigner }),
    { redeployImplementation: "always", unsafeAllowLinkedLibraries: true },
  );
  console.log("Governance upgraded successfully.");

  const { hash } = await (await hre.ethers.getContractAt("Governance", govAddress)).updateRewardReserve();
  console.log({ hash });
  await hre.run("checkGainz");

  // console.log("\nSaving artifacts");
  // for (const [contract, address] of [["Governance", govAddress]]) {
  //   const { abi, metadata } = await hre.deployments.getExtendedArtifact(contract);
  //   await hre.deployments.save(contract, { abi, metadata, address });
  // }

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");
});
