import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { getRouterLibraries } from "../utilities";
import { Router } from "../typechain-types";
import PriceOracleBuild from "../artifacts/contracts/PriceOracle.sol/PriceOracle.json";
import { getCreate2Address, keccak256, solidityPackedKeccak256 } from "ethers";

task("upgradeRouter", "").setAction(async (_, hre) => {
  const { ethers } = hre;

  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const routerAddress = await router.getAddress();
  const routerFactory = async () =>
    ethers.getContractFactory("Router", {
      libraries: await getRouterLibraries(ethers),
    });

  const routerProxy = await hre.upgrades.forceImport(routerAddress, await routerFactory());

  await hre.run("compile");
  await hre.upgrades.upgradeProxy(routerProxy, await routerFactory(), {
    unsafeAllow: ["external-library-linking"],
  });

  const { abi, metadata } = await hre.deployments.getExtendedArtifact("Router");
  await hre.deployments.save("Router", { abi, metadata, address: routerAddress });

  await router.setPriceOracle();
  const allPairs = await router.pairs();

  const priceOracle = await ethers.getContractAt(
    "PriceOracle",
    getCreate2Address(
      routerAddress,
      solidityPackedKeccak256(["address"], [routerAddress]),
      keccak256(PriceOracleBuild.bytecode),
    ),
  );

  await Promise.allSettled(
    allPairs.map(async pair => {
      const Pair = await ethers.getContractAt("Pair", pair);
      console.log({pair});
      await priceOracle.add(Pair.token0(), Pair.token1());
    }),
  );

  const { save, getExtendedArtifact } = hre.deployments;

  const artifactsToSave = [
    ["Router", routerAddress],
    ["WNTV", await router.getWrappedNativeToken()],
  ];

  for (const [contract, address] of artifactsToSave) {
    const { abi, metadata } = await getExtendedArtifact(contract);
    await save(contract, { abi, metadata, address });
  }

  await hre.deployments.run("generateTsAbis");
});
