import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router } from "../typechain-types";
import { computePriceOracleAddr, getGovernanceLibraries, getRouterLibraries, sleep } from "../utilities";

task("runUpgrade", "Upgrades updated contracts").setAction(async (_, hre) => {
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const router = await hre.ethers.getContract<Router>("Router", deployer);
  const gainz = await hre.ethers.getContract<Gainz>("Gainz", deployer);

  const gainzAddress = await gainz.getAddress();
  const routerAddress = await router.getAddress();

  const govAddress = await router.getGovernance();
  const governance = await hre.ethers.getContractAt("Governance", govAddress);

  const launchPairAddress = await governance.launchPair();

  console.log("Starting Upgrades");
  await hre.run("compile");

  // Gainz
  console.log("Upgrading Gainz");
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
  const { routerLibs, AMMLibrary } = await getRouterLibraries(hre.ethers, govLibs);

  const Views = await hre.ethers.getContractFactory("Views", {
    libraries: {
      AMMLibrary,
    },
  });
  const views = await Views.deploy(routerAddress, await router.getPairsBeacon());
  await views.waitForDeployment();

  // Router
  console.log("Upgrading Router");
  const routerFactory = () =>
    hre.ethers.getContractFactory("Router", { libraries: routerLibs, signer: deployerSigner });
  await hre.upgrades.forceImport(routerAddress, await routerFactory());
  const newRouter = await hre.upgrades.upgradeProxy(routerAddress, await routerFactory(), {
    redeployImplementation: "always",
    unsafeAllowLinkedLibraries: true,
  });
  console.log("Setting PriceOracle");
  try {
    await newRouter.setPriceOracle();
  } catch (error) {
    console.log("failed to set price oracle", { error });
  }
  console.log("Router upgraded successfully.");

  // Governance
  console.log("Upgrading Governance");
  const govFactory = () => hre.ethers.getContractFactory("Governance", { libraries: govLibs, signer: deployerSigner });
  await hre.upgrades.forceImport(govAddress, await govFactory());
  const newGovernance = await hre.upgrades.upgradeProxy(govAddress, await govFactory(), {
    redeployImplementation: "always",
    unsafeAllowLinkedLibraries: true,
  });
  console.log("Governance upgraded successfully.");

  console.log("Upgrading LaunchPair");
  const launchPairFactory = () =>
    hre.ethers.getContractFactory("LaunchPair", {
      signer: deployerSigner,
      libraries: { OracleLibrary: govLibs.OracleLibrary },
    });
  await hre.upgrades.forceImport(launchPairAddress, await launchPairFactory());
  const newLaunchPair = await hre.upgrades.upgradeProxy(launchPairAddress, await launchPairFactory(), {
    redeployImplementation: "always",
    unsafeAllowLinkedLibraries: true,
  });
  await newLaunchPair.acquireOwnership();
  console.log("LaunchPair upgraded successfully.");

  const oracleAddr = computePriceOracleAddr(routerAddress);
  const priceOracle = await hre.ethers.getContractAt("PriceOracle", oracleAddr);

  console.log("Adding Pairs to Oracle");
  await sleep(5_000);
  const pairs = await router.pairs();
  for (const pair of pairs) {
    await priceOracle.addPair(pair);
    console.log("Added", { pair, oracleAddr });
  }

  console.log("\nSaving artifacts");
  for (const [contract, address] of [
    ["Gainz", gainzAddress],
    ["Router", routerAddress],
    ["LaunchPair", launchPairAddress],
    ["PriceOracle", oracleAddr],
    ["Governance", govAddress],
    ["Views", await views.getAddress()],
  ]) {
    const { abi, metadata } = await hre.deployments.getExtendedArtifact(contract);
    await hre.deployments.save(contract, { abi, metadata, address });
  }

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");
});
