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
import { getRouterLibraries } from "../../utilities";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { hours } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";
import { TokenPaymentStruct } from "../../typechain-types/contracts/governance";

export async function routerFixture() {
  const [owner, ...users] = await ethers.getSigners();

  const gainzToken = await ethers.deployContract("TestERC20", ["GainZ Token", "GNZ", 18]);

  const routerLibs = await getRouterLibraries(ethers);
  const RouterFactory = await ethers.getContractFactory("Router", {
    libraries: routerLibs,
  });
  const router = await RouterFactory.deploy();
  await router.initialize(owner, gainzToken);

  const wrappedNativeToken = await router.getWrappedNativeToken();
  const routerAddress = await router.getAddress();
  const pairsBeacon = await router.getPairsBeacon();

  const governanceAddress = await router.getGovernance();
  const governance = await ethers.getContractAt("Governance", governanceAddress);
  const gTokenAddress = await governance.getGToken();
  const gToken = await ethers.getContractAt("GToken", gTokenAddress);

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

  await time.increase(hours(1));

  return {
    router,
    governance,
    gToken,
    gainzToken,
    createPair,
    createToken,
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
