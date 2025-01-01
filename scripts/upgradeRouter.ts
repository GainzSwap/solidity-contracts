import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { getGovernanceLibraries, getRouterLibraries } from "../utilities";
import { Router } from "../typechain-types";

task("upgradeRouter", "").setAction(async (_, hre) => {
  const { ethers } = hre;

  const govLib = await getGovernanceLibraries(ethers);
  const routerLibs = await getRouterLibraries(ethers, govLib);

  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const routerAddress = await router.getAddress();
  const governanceAddress = await router.getGovernance();

  const routerFactory = async () =>
    ethers.getContractFactory("Router", {
      libraries: routerLibs,
    });
  const governanceFactory = async () =>
    ethers.getContractFactory("Governance", {
      libraries: govLib,
    });

  await hre.run("compile");

  console.log("Upgrading Router");
  const routerProxy = await hre.upgrades.forceImport(routerAddress, await routerFactory());
  await hre.upgrades.upgradeProxy(routerProxy, await routerFactory(), {
    unsafeAllow: ["external-library-linking"],
  });

  console.log("Upgrading Governance");
  const governanceProxy = await hre.upgrades.forceImport(governanceAddress, await governanceFactory());
  await hre.upgrades.upgradeProxy(governanceProxy, await governanceFactory(), {
    unsafeAllow: ["external-library-linking"],
  });

  console.log("Setting price oracle");
  try {
    await router.setPriceOracle();
  } catch (error) {
    console.log("Error setting price oracle", error);
  }

  console.log("Adding pairs to price oracle");
  const OracleLib = await ethers.getContractAt("OracleLibrary", routerLibs.OracleLibrary);
  const allPairs = await router.pairs();
  const priceOracle = await ethers.getContractAt("PriceOracle", await OracleLib.oracleAddress(routerAddress));

  for (const pair of allPairs) {
    const Pair = await ethers.getContractAt("Pair", pair);
    const token0 = await Pair.token0();
    const token1 = await Pair.token1();

    console.log({ pair, token0, token1 });

    await priceOracle.add(token0, token1);
  }

  console.log("Saving artifacts");
  const { save, getExtendedArtifact } = hre.deployments;
  const governance = await ethers.getContractAt("Governance", governanceAddress);
  const artifactsToSave = [
    ["Router", routerAddress],
    ["WNTV", await router.getWrappedNativeToken()],
    ["Governance", governanceAddress],
    ["LaunchPair", await governance.launchPair()],
  ];

  for (const [contract, address] of artifactsToSave) {
    const { abi, metadata } = await getExtendedArtifact(contract);
    await save(contract, { abi, metadata, address });
  }

  await hre.deployments.run("generateTsAbis");
});
