import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router } from "../typechain-types";
import { getGovernanceLibraries, getRouterLibraries, sleep } from "../utilities";
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
  await newWntv.setup();
  await newWntv.setYuzuAggregator(deployer);
  console.log("WNTV upgraded successfully.");

  // Libraries
  console.log("Deploying Libraries");
  const govLibs = await getGovernanceLibraries(hre.ethers);
  const routerLibs = await getRouterLibraries(hre.ethers, govLibs);

  // Router
  console.log("Upgrading Router");
  const newRouter = await hre.upgrades.upgradeProxy(
    routerAddress,
    await hre.ethers.getContractFactory("Router", { libraries: routerLibs, signer: deployerSigner }),
    { redeployImplementation: "always", unsafeAllowLinkedLibraries: true },
  );
  console.log("Setting PriceOracle");
  try {
    await newRouter.setPriceOracle();
  } catch (error) {
    console.log("failed to set price oracle", { error });
  }
  console.log("Router upgraded successfully.");

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

  // Get contract factories for the new implementations
  const pairFactory = async () => hre.ethers.getContractFactory("Pair", { signer: deployerSigner });
  console.log("Force importing Pair beacon...");
  const pairBeacon = await hre.upgrades.forceImport(pairBeaconAddress, await pairFactory());
  // Upgrade the Beacon with the new implementation of Pair
  console.log("Upgrading Pair beacon...");
  await hre.upgrades.upgradeBeacon(pairBeacon, await pairFactory(), { redeployImplementation: "always" });
  console.log("Pair beacon upgraded successfully.");

  console.log("\nSaving artifacts");
  for (const [contract, address] of [
    ["Gainz", gainzAddress],
    ["WNTV", wntvAddr],
    ["Router", routerAddress],
    ["GToken", gTokenAddress],
    ["LaunchPair", launchPairAddress],
    ["Pair", ZeroAddress],
  ]) {
    const { abi, metadata } = await hre.deployments.getExtendedArtifact(contract);
    await hre.deployments.save(contract, { abi, metadata, address });
  }

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");

  await newLaunchPair.transferOwnership(govAddress);
});
