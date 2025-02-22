import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Router } from "../typechain-types";
import { getGovernanceLibraries } from "../utilities";

task("runUpgrade", "Upgrades updated contracts").setAction(async (_, hre) => {
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const router = await hre.ethers.getContract<Router>("Router", deployer);

  const routerAddress = await router.getAddress();
  const govAddress = await router.getGovernance();

  const governance = await hre.ethers.getContractAt("Governance", govAddress);

  const gTokenAddress = await governance.getGToken();
  const launchPairAddress = await governance.launchPair();

  console.log("Starting Upgrades");
  await hre.run("compile");

  const isLocalnet = hre.network.name == "localhost";

  // Libraries
  const govLibs = isLocalnet
    ? await getGovernanceLibraries(hre.ethers)
    : {
        DeployLaunchPair: "0x8d44C2133e768218990a427A60054353a58bb098",
        GovernanceLib: "0x5e53A42854180aa129fD1fC4ED5DB099692F9873",
        DeployGToken: "0xe023Cd85a42AEa666DE135a215cd5112d7960d18",
        OracleLibrary: "0xD318a96E32d3Ba5d2A911CaC02053Cb8Eb9484c8",
      };

  const Views = await hre.ethers.getContractFactory("Views", {
    libraries: {
      AMMLibrary: isLocalnet
        ? await (await hre.ethers.deployContract("AMMLibrary")).getAddress()
        : "0x2e6E165027Cbaad5A36FdeF77ee7B00A36EADe3D",
    },
  });
  const views = await Views.deploy(routerAddress, await router.getPairsBeacon());
  await views.waitForDeployment();

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

  // GToken
  console.log("Upgrading GToken");
  await hre.upgrades.forceImport(
    gTokenAddress,
    await hre.ethers.getContractFactory("GToken", { signer: deployerSigner }),
  );
  const newGToken = await hre.upgrades.upgradeProxy(
    gTokenAddress,
    await hre.ethers.getContractFactory("GToken", { signer: deployerSigner }),
    {
      redeployImplementation: "always",
    },
  );

  try {
    const uriPath = "/api/gToken/{id}.json" as const;
    const uri = (isLocalnet ? "http://localhost:3000" : "https://gainzswap.xyz") + uriPath;
    await newGToken.setURI(uri);
  } catch (error) {
    console.log(error);
  }
  console.log("GToken upgraded successfully.");

  console.log("Upgrading LaunchPair");
  await hre.upgrades.forceImport(
    launchPairAddress,
    await hre.ethers.getContractFactory("LaunchPair", { signer: deployerSigner }),
  );
  const newLaunchPair = await hre.upgrades.upgradeProxy(
    launchPairAddress,
    await hre.ethers.getContractFactory("LaunchPair", { signer: deployerSigner }),
    {
      redeployImplementation: "always",
    },
  );
  console.log("LaunchPair upgraded successfully.");

  for (const [contract, address] of [
    ["GToken", gTokenAddress],
    ["LaunchPair", launchPairAddress],
    ["Governance", govAddress],
    ["Views", await views.getAddress()],
  ]) {
    const { abi, metadata } = await hre.deployments.getExtendedArtifact(contract);
    await hre.deployments.save(contract, { abi, metadata, address });
  }

  // Run any additional tasks, such as generating TypeScript ABIs
  await hre.deployments.run("generateTsAbis");
});
