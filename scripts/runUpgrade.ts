import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router } from "../typechain-types";
import { getGovernanceLibraries, getRouterLibraries } from "../utilities";
import { ZeroAddress } from "ethers";

task("runUpgrade", "Upgrades updated contracts").setAction(async (_, hre) => {
  const { deployer, newOwner, newFeeTo } = await hre.getNamedAccounts();

  if (!newOwner || !newFeeTo) {
    throw new Error("Please set newOwner and newFeeTo named accounts");
  }
  if (deployer == newOwner || deployer == newFeeTo || newFeeTo == newOwner) {
    throw new Error("Required named accounts must be distinct");
  }

  const router = await hre.ethers.getContract<Router>("Router", deployer);
  const gainz = await hre.ethers.getContract<Gainz>("Gainz", deployer);

  const routerAddress = await router.getAddress();
  const gainzAddress = await gainz.getAddress();
  const pairBeaconAddress = await router.getPairsBeacon();

  const govAddress = await router.getGovernance();
  const governance = await hre.ethers.getContractAt("Governance", govAddress);

  const gTokenAddress = await governance.getGToken();
  const launchPairAddress = await governance.launchPair();

  console.log("Starting Upgrades");
  await hre.run("compile");

  // Gainz
  console.log("Upgrading Gainz");
  await hre.upgrades.forceImport(gainzAddress, await hre.ethers.getContractFactory("Gainz"));
  const newGainz = await hre.upgrades.upgradeProxy(gainzAddress, await hre.ethers.getContractFactory("Gainz"), {
    redeployImplementation: "always",
  });
  console.log("Gainz upgraded successfully.");

  // Libraries
  console.log("Deploying Libraries");
  const govLibs = await getGovernanceLibraries(hre.ethers);
  const routerLibs = await getRouterLibraries(hre.ethers, govLibs);

  // Router
  console.log("Upgrading Router");
  const newRouter = await hre.upgrades.upgradeProxy(
    routerAddress,
    await hre.ethers.getContractFactory("Router", { libraries: routerLibs }),
    { redeployImplementation: "always", unsafeAllowLinkedLibraries: true },
  );
  console.log("Setting PriceOracle");
  await newRouter.setPriceOracle();
  console.log("Router upgraded successfully.");

  // Governance
  console.log("Upgrading Governance");
  await hre.upgrades.forceImport(govAddress, await hre.ethers.getContractFactory("Governance", { libraries: govLibs }));
  await hre.upgrades.upgradeProxy(
    govAddress,
    await hre.ethers.getContractFactory("Governance", { libraries: govLibs }),
    { redeployImplementation: "always", unsafeAllowLinkedLibraries: true },
  );
  console.log("Governance upgraded successfully.");

  // GToken
  console.log("Upgrading GToken");
  await hre.upgrades.forceImport(gTokenAddress, await hre.ethers.getContractFactory("GToken"));
  await hre.upgrades.upgradeProxy(gTokenAddress, await hre.ethers.getContractFactory("GToken"), {
    redeployImplementation: "always",
  });
  console.log("GToken upgraded successfully.");

  console.log("Upgrading LaunchPair");
  await hre.upgrades.forceImport(launchPairAddress, await hre.ethers.getContractFactory("LaunchPair"));
  await hre.upgrades.upgradeProxy(launchPairAddress, await hre.ethers.getContractFactory("LaunchPair"), {
    redeployImplementation: "always",
  });
  console.log("LaunchPair upgraded successfully.");

  // Get contract factories for the new implementations
  const pairFactory = () => hre.ethers.getContractFactory("Pair");
  console.log("Force importing Pair beacon...");
  const pairBeacon = await hre.upgrades.forceImport(pairBeaconAddress, await pairFactory());
  // Upgrade the Beacon with the new implementation of Pair
  console.log("Upgrading Pair beacon...");
  await hre.upgrades.upgradeBeacon(pairBeacon, await pairFactory(), { redeployImplementation: "always" });
  console.log("Pair beacon upgraded successfully.");

  console.log("\nSaving artifacts");
  for (const [contract, address] of [
    ["Gainz", gainzAddress],
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

  console.log("Gainz ownership change");
  await newGainz.transferOwnership(newOwner);
  console.log("Router ownership change");
  await newRouter.transferOwnership(newOwner);

  console.log("new fee to");
  await newRouter.setFeeTo(newFeeTo);
  console.log("new fee to setter");
  await newRouter.setFeeToSetter(newFeeTo);

  console.log("Changing ProxyAdmin owner");
  const proxyAdminGainz = await hre.upgrades.erc1967.getAdminAddress(gainzAddress);
  const proxyAdminRouter = await hre.upgrades.erc1967.getAdminAddress(routerAddress);
  console.log({ proxyAdminGainz, proxyAdminRouter });

  await hre.upgrades.admin.transferProxyAdminOwnership(proxyAdminGainz, newOwner);
});
