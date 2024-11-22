import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployPairs: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hre.run("createInitialPairs", { network: hre.network.name });
};

export default deployPairs;

// Tags are useful if you have multiple deploy files and only want to run one of them.
// e.g. yarn deploy --tags Pairs
deployPairs.tags = ["initialDeployment"];
