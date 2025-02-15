import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";

task("runUpgrade", "Upgrades updated contracts").setAction(async (_, hre) => {
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const router = await hre.ethers.getContract<Router>("Router", deployer);
  const govAddress = await router.getGovernance();

  console.log("Starting Upgrades");
  await hre.run("compile");

  const govLibs = {
    DeployLaunchPair: "0x8fd0217f99B4B01315D799F6EDF6Bde80743B4bE",
    GovernanceLib: "0x97c0CdB40fcA3ca8bfCea70236085Ed6B6b49C5F",
    DeployGToken: "0xdeb422f287F0455Ea7228AA5a86F31BE387c025c",
    OracleLibrary: "0x89eC9Ca7F02F3D36d6DC62589A1045459e9599fE",
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

  for (const [contract, address] of [["Governance", govAddress]]) {
    const { abi, metadata } = await hre.deployments.getExtendedArtifact(contract);
    await hre.deployments.save(contract, { abi, metadata, address });
  }

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");
});
