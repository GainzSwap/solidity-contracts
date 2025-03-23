import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router } from "../typechain-types";
import { computePriceOracleAddr, getGovernanceLibraries, getRouterLibraries, sleep } from "../utilities";
import { ZeroAddress } from "ethers";

task("runUpgrade", "Upgrades updated contracts").setAction(async (_, hre) => {
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const router = await hre.ethers.getContract<Router>("Router", deployer);
  const gainz = await hre.ethers.getContract<Gainz>("Gainz", deployer);

  const routerAddress = await router.getAddress();
  const gainzAddress = await gainz.getAddress();
  const pairBeaconAddress = await router.getPairsBeacon();
  const wntvAddr = await router.getWrappedNativeToken();

  const govAddress = await router.getGovernance();
  const governance = await hre.ethers.getContractAt("Governance", govAddress);

  const gTokenAddress = await governance.getGToken();
  const launchPairAddress = await governance.launchPair();

  console.log("Starting Upgrades");
  await hre.run("compile");

  // Gainz
  console.log("Upgrading Gainz");
  await hre.upgrades.forceImport(
    gainzAddress,
    await hre.ethers.getContractFactory("Gainz", { signer: deployerSigner }),
  );
  const newGainz = await hre.upgrades.upgradeProxy(
    gainzAddress,
    await hre.ethers.getContractFactory("Gainz", { signer: deployerSigner }),
    {
      redeployImplementation: "always",
    },
  );
  console.log("Gainz upgraded successfully.");

  // Libraries
  console.log("Deploying Libraries");
  const govLibs = await getGovernanceLibraries(hre.ethers);

  // Governance
  console.log("Upgrading Governance");
  await hre.upgrades.forceImport(
    govAddress,
    await hre.ethers.getContractFactory("Governance", { libraries: govLibs, signer: deployerSigner }),
  );
  const newGovernance = await hre.upgrades.upgradeProxy(
    govAddress,
    await hre.ethers.getContractFactory("Governance", { libraries: govLibs, signer: deployerSigner }),
    { redeployImplementation: "always", unsafeAllowLinkedLibraries: true },
  );
  console.log("Governance upgraded successfully.");

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
  await newLaunchPair.acquireOwnership();
  console.log("LaunchPair upgraded successfully.");

  console.log("\nSaving artifacts");
  for (const [contract, address] of [
    ["Gainz", gainzAddress],
    ["LaunchPair", launchPairAddress],
    ["Governance", govAddress],
  ]) {
    const { abi, metadata } = await hre.deployments.getExtendedArtifact(contract);
    await hre.deployments.save(contract, { abi, metadata, address });
  }

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");
});
