import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";

task("runUpgrade", "Upgrades updated contracts").setAction(async (_, hre) => {
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const router = await hre.ethers.getContract<Router>("Router", deployer);

  const routerAddress = await router.getAddress();

  console.log("Starting Upgrades");
  await hre.run("compile");

  const routerLibs = {
    OracleLibrary: "0x89eC9Ca7F02F3D36d6DC62589A1045459e9599fE",
    DeployWNTV: "0xeBA86b67Fa4D83Da5CA29346b4C67d181D44aAc5",
    RouterLib: "0xa47da8897B719621CFfde6dE595453126d27832d",
    UserModuleLib: "0x2CD52db3A408Ad4A37929681DdA5913b50865496",
    DeployPriceOracle: "0x5b653246f1d172923c86e79F3BCa9088BD0a85CF",
    DeployGovernance: "0x416AB872e4faA10e140E9e5F193eF441CF914751",
  };

  // Router
  console.log("Upgrading Router");
  const newRouter = await hre.upgrades.upgradeProxy(
    routerAddress,
    await hre.ethers.getContractFactory("Router", { libraries: routerLibs, signer: deployerSigner }),
    { redeployImplementation: "always", unsafeAllowLinkedLibraries: true },
  );
  console.log("Router upgraded successfully.");

  for (const [contract, address] of [["Router", routerAddress]]) {
    const { abi, metadata } = await hre.deployments.getExtendedArtifact(contract);
    await hre.deployments.save(contract, { abi, metadata, address });
  }

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");
});
