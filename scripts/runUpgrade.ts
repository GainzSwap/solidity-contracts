import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";

task("runUpgrade", "Upgrades updated contracts").setAction(async (_, hre) => {
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const router = await hre.ethers.getContract<Router>("Router", deployer);

  const govAddress = await router.getGovernance();
  const governance = await hre.ethers.getContractAt("Governance", govAddress);

  const gTokenAddress = await governance.getGToken();
  const launchPairAddress = await governance.launchPair();

  console.log("Starting Upgrades");
  await hre.run("compile");

  // Libraries
  const govLibs = {
    DeployLaunchPair: "0x8d44C2133e768218990a427A60054353a58bb098",
    GovernanceLib: "0x5e53A42854180aa129fD1fC4ED5DB099692F9873",
    DeployGToken: "0xe023Cd85a42AEa666DE135a215cd5112d7960d18",
    OracleLibrary: "0xD318a96E32d3Ba5d2A911CaC02053Cb8Eb9484c8",
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

  // GToken
  console.log("Upgrading GToken");
  await hre.upgrades.forceImport(
    gTokenAddress,
    await hre.ethers.getContractFactory("GToken", { signer: deployerSigner }),
  );
  await hre.upgrades.upgradeProxy(
    gTokenAddress,
    await hre.ethers.getContractFactory("GToken", { signer: deployerSigner }),
    {
      redeployImplementation: "always",
    },
  );
  console.log("GToken upgraded successfully.");

  console.log("Upgrading LaunchPair");
  await hre.upgrades.forceImport(
    launchPairAddress,
    await hre.ethers.getContractFactory("LaunchPair", { signer: deployerSigner }),
  );
  const newLaunchPair = await hre.upgrades.upgradeProxy(
    launchPairAddress,
    await hre.ethers.getContractFactory("LaunchPair", { signer: deployerSigner }),
    {
      redeployImplementation: "always",
    },
  );
  console.log("LaunchPair upgraded successfully.");

  for (const [contract, address] of [
    ["GToken", gTokenAddress],
    ["LaunchPair", launchPairAddress],
    ["Governance", govAddress],
  ]) {
    const { abi, metadata } = await hre.deployments.getExtendedArtifact(contract);
    await hre.deployments.save(contract, { abi, metadata, address });
  }

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");
});
