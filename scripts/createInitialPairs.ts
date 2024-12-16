import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import { Gainz, Router, Views } from "../typechain-types";
import { formatEther as _formatEther, parseEther as _parseEther } from "ethers";
import { parseEther } from "../utilities";

const formatEther = (wei: Parameters<typeof _formatEther>[0]) =>
  parseFloat(_formatEther(wei)).toLocaleString("en-US", {
    minimumFractionDigits: 18,
    maximumFractionDigits: 18,
  });

task("createInitialPairs", "").setAction(async (_, hre) => {
  if (hre.network.name !== "localhost") {
    return;
  }
  const { ethers } = hre;
  const [deployer, founder, angel, SI, initLp] = await ethers.getSigners();

  const router = await ethers.getContract<Router>("Router", deployer);
  const views = await ethers.getContract<Views>("Views", deployer);
  const governance = await ethers.getContractAt("Governance", await router.getGovernance());
  const gToken = await ethers.getContractAt("GToken", await governance.getGToken());

  const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
  const gainzAddress = await gainz.getAddress();
  const maxSupply = await gainz.totalSupply();

  const wNativeToken = await router.getWrappedNativeToken();

  const lpPartnersGainz = parseEther(process.env.LP_PARTNERS_GAINZ!);
  const eduPockets: [string, bigint][] = process.env.LP_PARTNERS_EDU_DISTRIBUTION!.split(";").map(group => {
    const [eduRaised, discount] = group.split("-");

    return [eduRaised, (BigInt(discount) * lpPartnersGainz) / 100n];
  });

  let totalGainzUsed = 0n;

  // Initial liquidity
  const initLiq = eduPockets.shift()!;
  const paymentA = { token: wNativeToken, nonce: 0, amount: parseEther(initLiq[0]) };
  const paymentB = { token: gainzAddress, nonce: 0, amount: initLiq[1] };

  await gainz.approve(router, paymentB.amount);
  await router.connect(deployer).createPair(paymentA, paymentB, { value: paymentA.amount });

  totalGainzUsed += paymentB.amount;

  // Other Community Discount Liquidty
  for (const [amt, gainzAmt] of eduPockets) {
    const amount = parseEther(amt);

    await governance
      .connect(initLp)
      .stake({ ...paymentA, amount }, 1080, [[wNativeToken], [wNativeToken, gainzAddress], [wNativeToken]], 1, 1, {
        value: amount,
      });

    const gainzPayment = { token: gainzAddress, nonce: 0, amount: gainzAmt };

    await gainz.transfer(initLp, gainzPayment.amount);
    await gainz.connect(initLp).approve(governance, gainzPayment.amount);
    await governance
      .connect(initLp)
      .stake(gainzPayment, 1080, [[gainzAddress], [gainzAddress, wNativeToken], [gainzAddress, wNativeToken]], 1, 1);

    totalGainzUsed += gainzPayment.amount;

    console.log({
      amount: formatEther(amount),
      gainzAmt: formatEther(gainzAmt),
    });
  }

  if (process.env.IS_ANGEL_FUNDED) {
    await gainz.transfer(founder, (maxSupply * 2n) / 100n);
    await gainz.transfer(angel, (maxSupply * 7n) / 100n);
    await gainz.transfer(SI, (maxSupply * 10n) / 100n);
  }

  console.log({
    totalGainzUsed: formatEther(totalGainzUsed),
    ratio: +totalGainzUsed.toString() / +maxSupply.toString(),
  });
});
