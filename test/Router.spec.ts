import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { routerFixture } from "./shared/fixtures";
import { expect } from "chai";
import { Addressable, parseEther, ZeroAddress } from "ethers";
import { TokenPaymentStruct } from "../typechain-types/contracts/Router";
import { ethers } from "hardhat";

describe("Router", function () {
  it("allPairsLength", async () => {
    const { router } = await loadFixture(routerFixture);

    expect(await router.allPairsLength()).to.eq(0);
  });
  const nativePayment: TokenPaymentStruct = { token: ZeroAddress, amount: parseEther("0.001"), nonce: 0 };

  describe("createPair", function () {
    it("works:native-ERC20", async () => {
      const { createPair } = await loadFixture(routerFixture);

      await createPair({ paymentA: nativePayment });
    });

    it("works:ERC20-native", async () => {
      const { createPair } = await loadFixture(routerFixture);

      await createPair({ paymentB: nativePayment });
    });

    it("works:ERC20-ERC20", async () => {
      const { createPair, createToken } = await loadFixture(routerFixture);

      const tokenA = await createToken(15);
      const tokenB = await createToken(8);

      await createPair({
        paymentA: { token: tokenA, nonce: 0, amount: parseEther("1000") },
        paymentB: { token: tokenB, nonce: 0, amount: parseEther("0.1") },
      });
    });
  });

  describe("registers and executes swapExactTokensForTokens", function () {
    async function setupTokens(tokensCount?: 1 | 2) {
      const { createPair, createToken, ...fixtures } = await loadFixture(routerFixture);

      let createPairParams: Parameters<typeof createPair> = [undefined];

      const paymentA = tokensCount && { token: await createToken(18), amount: parseEther("10"), nonce: 0 };
      if (paymentA)
        switch (tokensCount) {
          case 1:
            createPairParams = [{ paymentA }];

            break;
          case 2:
            createPairParams = [
              {
                paymentA,
                paymentB: { token: await createToken(15), amount: parseEther("1"), nonce: 0 },
              },
            ];
            break;
          default:
            break;
        }

      // Deploy native and ERC20 tokens for swapping
      const [nativePayment, erc20Payment] = await createPair(...createPairParams);

      return { nativePayment, erc20Payment, ...fixtures };
    }

    it("works:native-ERC20", async () => {
      const {
        router,
        nativePayment,
        erc20Payment,
        users: [user1, user2],
        RouterFactory,
      } = await setupTokens();

      // Define swap parameters
      const amountIn = parseEther("10");
      const amountOutMin = 0n;
      const path = [nativePayment.token.toString(), await (erc20Payment.token as Addressable).getAddress()];
      const deadline = (await time.latest()) + 60 * 20;

      // Encode swapExactTokensForTokens as swapData

      const args = [amountIn, amountOutMin, path, user1.address, deadline];
      const swapData = RouterFactory.interface.encodeFunctionData("swapExactTokensForTokens", args);

      // Perform the registerAndSwap user1
      const referrerUser1Id = 0; // Example referrer ID
      await expect(router.connect(user1).registerAndSwap(referrerUser1Id, swapData, { value: amountIn }))
        .to.emit(router, "UserRegistered")
        .withArgs(1, user1, referrerUser1Id);

      // Perform the registerAndSwap user2
      const referrerUser2Id = 1; // Example referrer ID
      await expect(router.connect(user2).registerAndSwap(referrerUser2Id, swapData, { value: amountIn }))
        .to.emit(router, "UserRegistered")
        .withArgs(2, user2, referrerUser2Id)
        .to.emit(router, "ReferralAdded")
        .withArgs(referrerUser2Id, 2);

      expect(await router.totalUsers()).to.eq(2);
    });

    // it("works:ERC20-native", async () => {
    //   const {
    //     router,
    //     nativePayment,
    //     erc20Payment,
    //     users: [user1, user2],
    //     RouterFactory,
    //   } = await setupTokens();

    //   // Define swap parameters
    //   const amountIn = parseEther("10");
    //   const amountOutMin = 0n;
    //   const path = [nativePayment.token.toString(), await (erc20Payment.token as Addressable).getAddress()].reverse();
    //   const deadline = (await time.latest()) + 60 * 20;

    //   // Encode swapExactTokensForTokens as swapData

    //   const args = [amountIn, amountOutMin, path, user1.address, deadline];
    //   const swapData = RouterFactory.interface.encodeFunctionData("swapExactTokensForTokens", args);

    //   // Perform the registerAndSwap user1
    //   const referrerUser1Id = 0; // Example referrer ID
    //   await expect(router.connect(user1).registerAndSwap(referrerUser1Id, swapData))
    //     .to.emit(router, "UserRegistered")
    //     .withArgs(1, user1, referrerUser1Id);

    //   // Perform the registerAndSwap user2
    //   const referrerUser2Id = 1; // Example referrer ID
    //   await expect(router.connect(user2).registerAndSwap(referrerUser2Id, swapData))
    //     .to.emit(router, "UserRegistered")
    //     .withArgs(2, user2, referrerUser2Id)
    //     .to.emit(router, "ReferralAdded")
    //     .withArgs(referrerUser2Id, 2);

    //   expect(await router.totalUsers()).to.eq(2);
    // });

    it("reverts if swapData fails", async () => {
      const {
        router,
        nativePayment,
        erc20Payment,
        users: [user],
        RouterFactory,
      } = await setupTokens();

      // Define swap parameters
      const amountIn = parseEther("10");
      const amountOutMin = 0n;
      const path = [nativePayment.token.toString(), await (erc20Payment.token as Addressable).getAddress()];
      const deadline = (await time.latest()) + 60 * 20;

      // Encode swapExactTokensForTokens as swapData
      const args = [amountIn, amountOutMin, path, user.address, deadline];
      const swapData = RouterFactory.interface.encodeFunctionData("swapExactTokensForTokens", args);

      // Expect the transaction to revert due to past deadline
      await expect(router.registerAndSwap(1, swapData, { value: parseEther("0") })).to.be.revertedWithCustomError(
        await ethers.getContractAt("ERC20", path[0]),
        "ERC20InsufficientAllowance",
      );
    });
  });
});
