import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router, Views } from "../typechain-types";
import { parseEther, ZeroAddress } from "ethers";
import { createERC20, CreateERC20Type } from "./createERC20";
import { getRandomItem, getSwapTokens, isAddressEqual, randomNumber } from "../utilities";
import { days } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";

task("createInitialPairs", "").setAction(async (_, hre) => {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const gainzAddress = await gainz.getAddress();

  const router = await ethers.getContract<Router>("Router", deployer);
  const wNativeToken = await router.getWrappedNativeToken();

  const governanceAddress = await router.getGovernance();
  const governance = await ethers.getContractAt("Governance", governanceAddress);

  const gTokenAddress = await governance.getGToken();
  const gToken = await ethers.getContractAt("GToken", gTokenAddress);

  const launchPairAddress = await governance.launchPair();
  const launchPair = await ethers.getContractAt("LaunchPair", launchPairAddress);
  await launchPair.acquireOwnership();

  await hre.run("listGainz");

  await hre.run("deployERC20", {
    name: "USDC",
    symbol: "USDC",
    decimals: "8",
  });

  const { swapTokens } = await getSwapTokens(router, hre.ethers);
  for (const tokenAddress of swapTokens) {
    await launchPair.addAllowedPairedToken(
      isAddressEqual(tokenAddress, wNativeToken) ? [wNativeToken] : [tokenAddress, wNativeToken],
    );
  }

  for (let index = 1; index <= 5; index++) {
    const { tokenAddress } = await createERC20(
      { decimals: randomNumber(0, 18).toFixed(0), name: `${index} Token`, symbol: `${index}TK` },
      hre,
    );
    const { selectTokens } = await getSwapTokens(router, ethers);
    const { tokenIn } = selectTokens();
    await hre.run("createPair", {
      tokenA: tokenAddress,
      amountA: "0.035",
      tokenB: tokenIn,
      amountB: "0.0034",
    });
  }

  const views = await ethers.getContract<Views>("Views", deployer);

  const listingLiqValue = await launchPair.minLiqValueForListing();

  const ILOs: CreateERC20Type[] = [
    { name: "Book Spine", symbol: "BKSP", decimals: "18" },
    { name: "Grasp Academy", symbol: "GRASP", decimals: "18" },
    { name: "Owlbert Eistein", decimals: "2", symbol: "EMC2" },
    { name: "Capy Friends", decimals: "8", symbol: "Yuzu" },
  ];
  const signers = (await ethers.getSigners()).slice(0, ILOs.length).reverse();
  for (const createParams of ILOs) {
    const signer = signers.pop();
    if (!signer) throw "NO signer";

    // Get Security token
    const gainzAmount = await views.getQuote(listingLiqValue, [wNativeToken, gainzAddress]);
    await gainz.transfer(signer, gainzAmount);
    await gainz.connect(signer).approve(governance, gainzAmount);
    await governance
      .connect(signer)
      .stakeLiquidity(
        { amount: listingLiqValue, token: wNativeToken, nonce: 0 },
        { amount: gainzAmount, token: gainzAddress, nonce: 0 },
        1080,
        [1, 1, Number.MAX_SAFE_INTEGER],
        [gainzAddress, wNativeToken],
        { value: listingLiqValue },
      );
    const securityPayment = await gToken
      .getGTokenBalance(signer)
      .then(tokens => tokens.find(token => token.amount >= listingLiqValue && token.attributes.epochsLocked >= 1079n));
    if (!securityPayment) throw "Did not get security paymnet";

    const { tokenAddress, tokenName, tokenSymbol, token } = await createERC20(createParams, hre);

    console.log("\nLaunching ILO", { tokenAddress, tokenName, tokenSymbol }, "\n\n");

    const lpAmount = (await token.balanceOf(deployer)) / 2n;
    const goal = parseEther(randomNumber(35_000, 270_000).toFixed(18));

    await token.mint(signer, lpAmount);
    await token.connect(signer).approve(launchPair, lpAmount);
    await gToken.connect(signer).setApprovalForAll(launchPair, true);

    await launchPair
      .connect(signer)
      .createCampaign(
        { nonce: securityPayment.nonce, amount: securityPayment.amount, token: gTokenAddress },
        { nonce: 0, amount: lpAmount, token: tokenAddress },
        getRandomItem(await launchPair.allowedPairedTokens()),
        goal,
        days(+randomNumber(30, 40).toFixed(0)),
        randomNumber(90, 1080),
      );
  }
});
