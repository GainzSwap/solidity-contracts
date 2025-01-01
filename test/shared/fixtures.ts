import { ethers } from "hardhat";
import { expect } from "chai";

import {
  BaseContract,
  BigNumberish,
  getBigInt,
  getCreate2Address,
  keccak256,
  parseEther,
  solidityPackedKeccak256,
  ZeroAddress,
} from "ethers";
import { getPairProxyAddress } from "./utilities";

import PriceOracleBuild from "../../artifacts/contracts/PriceOracle.sol/PriceOracle.json";
import { getGovernanceLibraries, getRouterLibraries } from "../../utilities";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { hours } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";
import type { TokenPaymentStruct } from "../../typechain-types/contracts/Governance";
import type { ERC20, Router, TestERC20 } from "../../typechain-types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export async function routerFixture() {
  const [owner, ...users] = await ethers.getSigners();

  const gainzToken = await ethers.deployContract("TestERC20", ["GainZ Token", "GNZ", 18]);
  const gainzTokenAddr = await gainzToken.getAddress();

  const routerLibs = await getRouterLibraries(ethers, await getGovernanceLibraries(ethers));
  const RouterFactory = await ethers.getContractFactory("Router", {
    libraries: routerLibs,
  });
  const router = await RouterFactory.deploy();
  await router.initialize(owner, gainzToken);
  await router.setPriceOracle();

  const wrappedNativeToken = await router.getWrappedNativeToken();
  const routerAddress = await router.getAddress();
  const pairsBeacon = await router.getPairsBeacon();

  const governanceAddress = await router.getGovernance();
  const governance = await ethers.getContractAt("Governance", governanceAddress);
  const gTokenAddress = await governance.getGToken();
  const gToken = await ethers.getContractAt("GToken", gTokenAddress);

  const launchPairContract = await ethers.getContractAt("LaunchPair", await governance.launchPair());

  const priceOracle = await ethers.getContractAt(
    "PriceOracle",
    getCreate2Address(
      routerAddress,
      solidityPackedKeccak256(["address"], [routerAddress]),
      keccak256(PriceOracleBuild.bytecode),
    ),
  );
  expect(await priceOracle.router()).to.eq(routerAddress);

  let tokensCreated = 0;
  const createToken = async (decimals: BigNumberish) => {
    tokensCreated++;

    return await ethers.deployContract("TestERC20", ["Token" + tokensCreated, "TK-" + tokensCreated, decimals]);
  };

  async function createPair(
    args: { paymentA?: TokenPaymentStruct; paymentB?: TokenPaymentStruct; pairsCreated?: number } = {},
  ) {
    const pairsCreated = args.pairsCreated ?? 1;

    if (!args.paymentA && !args.paymentB) {
      args.paymentA = { token: wrappedNativeToken, nonce: 0, amount: parseEther("1000") };
      args.paymentB = { token: await createToken(8), nonce: 0, amount: parseEther("10") };
    }

    if (!args.paymentA) {
      args.paymentA = {
        token: args.paymentB?.token == ZeroAddress ? await createToken(12) : wrappedNativeToken,
        nonce: 0,
        amount: parseEther("10"),
      };
    }

    if (!args.paymentB) {
      args.paymentB = {
        token: args.paymentA.token == ZeroAddress ? await createToken(8) : wrappedNativeToken,
        nonce: 0,
        amount: parseEther("10"),
      };
    }

    const payments = [args.paymentA, args.paymentB].map(payment => ({
      ...payment,
      token: payment.token == ZeroAddress ? wrappedNativeToken : payment.token,
    })) as [TokenPaymentStruct, TokenPaymentStruct];

    const value = payments.reduce(
      (value, payment) => (payment.token == wrappedNativeToken ? getBigInt(payment.amount) : value),
      0n,
    );

    let tokens: [string, string] = ["", ""];
    for (let { token, index, amount } of payments.map(({ token, amount }, index) => ({ token, index, amount }))) {
      if (token instanceof BaseContract) {
        token = await token.getAddress();
      }

      const tokenAddr = (tokens[index] = token.toString());

      // Allowance
      if (tokenAddr != wrappedNativeToken) {
        const testToken = await ethers.getContractAt("TestERC20", tokenAddr);
        await testToken.mintApprove(owner, routerAddress, amount);
      }
    }
    const [tokenA, tokenB] = tokens.sort((a, b) => parseInt(a, 16) - parseInt(b, 16));

    const pairProxy = await getPairProxyAddress(routerAddress, pairsBeacon, [tokenA, tokenB]);

    await expect(router.createPair(...payments, { value }))
      .to.emit(router, "PairCreated")
      .withArgs(tokenA, tokenB, pairProxy, pairsCreated);

    const paymentsReversed = payments.slice().reverse() as typeof payments;
    const tokensReversed = tokens.slice().reverse() as typeof tokens;

    await expect(router.createPair(...payments, { value })).to.be.revertedWithCustomError(router, "PairExists");
    await expect(router.createPair(...paymentsReversed, { value })).to.be.revertedWithCustomError(router, "PairExists");
    expect(await router.getPair(...tokens)).to.eq(pairProxy);
    expect(await router.getPair(...tokensReversed)).to.eq(pairProxy);
    expect(await router.allPairs(pairsCreated - 1)).to.eq(pairProxy);
    expect(await router.allPairsLength()).to.eq(pairsCreated);

    const pair = await ethers.getContractAt("Pair", pairProxy);
    expect(await pair.router()).to.eq(routerAddress);
    expect(await pair.token0()).to.eq(tokenA);
    expect(await pair.token1()).to.eq(tokenB);
    expect(await pair.balanceOf(owner)).to.be.gt(0);

    await priceOracle.update(pair);
    expect(await priceOracle.consult(payments[0].token, payments[1].token, payments[0].amount)).to.gt(0);

    return [...payments, pairProxy] as [TokenPaymentStruct, TokenPaymentStruct, string];
  }

  const addLiquidity = async (
    {
      signer = users[0],
      mint = true,
    }: {
      signer?: HardhatEthersSigner;
      mint?: boolean;
    },
    ...args: Parameters<Router["addLiquidity"]>
  ) => {
    const [paymentA, paymentB] = args;
    for (const payment of [paymentA, paymentB] as [TokenPaymentStruct, TokenPaymentStruct]) {
      const tradeToken = (await ethers.getContractAt("ERC20", payment.token.toString())) as TestERC20 | ERC20;

      if (mint) {
        "mint" in tradeToken
          ? await tradeToken.connect(owner).mint(signer, payment.amount)
          : await tradeToken.connect(owner).transfer(signer, payment.amount);
      }

      tradeToken.connect(signer).approve(router, payment.amount);
    }
    return router.connect(signer).addLiquidity(...args);
  };

  const stake = async (
    signer = users[0],
    otherParams: {
      epochsLocked?: number;
      amount?: { gainzAmount: BigNumberish } | { nativeAmount: BigNumberish };
    } = {},
  ) => {
    if (otherParams.epochsLocked == undefined) {
      otherParams.epochsLocked = 1080;
    }
    if (otherParams.amount == undefined) {
      otherParams.amount = { nativeAmount: parseEther("900") };
    }

    const { epochsLocked, amount } = otherParams;

    const payment = {
      ...("gainzAmount" in amount
        ? { token: gainzTokenAddr, amount: amount.gainzAmount }
        : { token: wrappedNativeToken, amount: amount.nativeAmount }),
      nonce: 0,
    };

    if (payment.token != wrappedNativeToken) {
      await gainzToken.mintApprove(signer, governance, payment.amount);
    }

    // User enters governance
    await governance
      .connect(signer)
      .stake(
        payment,
        epochsLocked,
        [[payment.token], [payment.token, payment.token == gainzTokenAddr ? wrappedNativeToken : gainzTokenAddr], []],
        0,
        0,
        {
          // @ts-expect-error
          value: amount.nativeAmount || 0n,
        },
      );

    await gToken.connect(signer).setApprovalForAll(governance, true);

    return await gToken.getGTokenBalance(signer);
  };

  await time.increase(hours(1));

  return {
    router,
    governance,
    gToken,
    gainzToken,
    launchPairContract,
    createPair,
    createToken,
    addLiquidity,
    stake,
    owner,
    users,
    governanceAddress,
    routerAddress,
    wrappedNativeToken,
    feeTo: await router.feeTo(),
    RouterFactory,
    routerLibs,
  };
}

export async function claimRewardsFixture() {
  const { router, createPair, gainzToken, owner, governance, ...fixtures } = await routerFixture();

  const [, , gainzNativePairAddr] = await createPair({
    paymentA: { amount: parseEther("100"), nonce: 0, token: ZeroAddress },
    paymentB: { token: gainzToken, amount: parseEther("0.001"), nonce: 0 },
  });
  return {
    gainzToken,
    gainzNativePair: await ethers.getContractAt("Pair", gainzNativePairAddr),
    owner,
    governance,
    epochLength: (await governance.epochs()).epochLength,
    LISTING_FEE: await governance.listing_fees(),
    router,
    ...fixtures,
  };
}
