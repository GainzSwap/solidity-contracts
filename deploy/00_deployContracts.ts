import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getGovernanceLibraries, getRouterLibraries } from "../utilities";

const deployRouterContract: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { upgrades } = hre;
  const { ethers } = hre;

  const Gainz = await ethers.getContractFactory("Gainz");
  const gainzToken = await upgrades.deployProxy(Gainz);
  await gainzToken.waitForDeployment();

  const Router = await ethers.getContractFactory("Router", {
    libraries: await getRouterLibraries(ethers, await getGovernanceLibraries(ethers)),
  });
  const gainzAddress = await gainzToken.getAddress();
  const router = await upgrades.deployProxy(Router, [deployer, gainzAddress], {
    unsafeAllow: ["external-library-linking"],
  });
  await router.waitForDeployment();
  await router.setPriceOracle();

  await gainzToken.runInit(await router.getGovernance());

  const routerAddress = await router.getAddress();

  const Views = await ethers.getContractFactory("Views", {
    libraries: {
      AMMLibrary: await (await ethers.deployContract("AMMLibrary")).getAddress(),
    },
  });
  const views = await Views.deploy(routerAddress, await router.getPairsBeacon());
  await views.waitForDeployment();

  const wntv = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());

  await wntv.setup();
  await wntv.setYuzuAggregator(deployer);

  const artifactsToSave = [
    ["Gainz", gainzAddress],
    ["Router", routerAddress],
    ["Views", await views.getAddress()],
  ];

  const { save, getExtendedArtifact } = hre.deployments;
  for (const [contract, address] of artifactsToSave) {
    const { abi, metadata } = await getExtendedArtifact(contract);
    await save(contract, { abi, metadata, address });
  }
};

export default deployRouterContract;

// Tags are useful if you have multiple deploy files and only want to run one of them.
// e.g. yarn deploy --tags RouterContract
deployRouterContract.tags = ["initialDeployment"];
