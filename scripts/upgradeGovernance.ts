import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types/contracts/Router.sol";
import { getGovernanceLibraries } from "../utilities";

task("upgradeGovernance", "Upgrades governance").setAction(async (_, hre) => {
  await hre.run("compile");

  const { ethers } = hre;

  const { deployer } = await hre.getNamedAccounts();
  const router = await ethers.getContract<Router>("Router", deployer);
  const governanceAddress = await router.getGovernance();
  const governanceFactory = async () =>
    ethers.getContractFactory("Governance", {
      libraries: await getGovernanceLibraries(ethers),
    });

  const governanceProxy = await hre.upgrades.forceImport(governanceAddress, await governanceFactory());

  await hre.upgrades.upgradeProxy(governanceProxy, await governanceFactory(), {
    unsafeAllow: ["external-library-linking"],
  });

  const governance = await ethers.getContractAt("Governance", governanceAddress);

  // These contracts will be indexed on our graph
  const artifactsToSave = [
    ["Governance", governanceAddress],
    ["LaunchPair", await governance.launchPair()],
  ];

  const { save, getExtendedArtifact } = hre.deployments;
  for (const [contract, address] of artifactsToSave) {
    const { abi, metadata } = await getExtendedArtifact(contract);

    await save(contract, {
      abi,
      metadata,
      address,
    });
  }

  await hre.deployments.run("generateTsAbis");
});
