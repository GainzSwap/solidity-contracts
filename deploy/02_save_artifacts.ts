import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ZeroAddress } from "ethers";
import { Router } from "../typechain-types/contracts/Router.sol";

const deployPairs: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // Done to have the abi in front end
  const { deployer } = await hre.getNamedAccounts();
  const { ethers } = hre;

  const router = await ethers.getContract<Router>("Router", deployer);
  const wNativeToken = await router.getWrappedNativeToken();
  // const priceOracle = await ethers.getContractAt(
  //   "PriceOracle",
  //   getCreate2Address(
  //     routerAddress,
  //     solidityPackedKeccak256(["address"], [routerAddress]),
  //     keccak256(PriceOralcleBuild.bytecode),
  //   ),
  // );

  const { save, getExtendedArtifact } = hre.deployments;

  const governanceAdr = await router.getGovernance();
  const governance = await hre.ethers.getContractAt("Governance", governanceAdr);
  const gTokenAddr = await governance.getGToken();

  const artifactsToSave = [
    ["Pair", ZeroAddress],
    ["Governance", governanceAdr],
    ["GToken", gTokenAddr],
    ["WNTV", wNativeToken],
  ];

  for (const [contract, address] of artifactsToSave) {
    const { abi, metadata } = await getExtendedArtifact(contract);
    await save(contract, { abi, metadata, address });
  }
};

export default deployPairs;

// Tags are useful if you have multiple deploy files and only want to run one of them.
// e.g. yarn deploy --tags Pairs
deployPairs.tags = ["initialDeployment", "saveArtifacts"];
