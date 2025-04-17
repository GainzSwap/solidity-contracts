import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import swap from "./swap";
import stake from "./stake";
import { getRandomItem, randomNumber, shuffleArray } from "../../utilities";
import fundCampaign from "./fundCampaign";
import claimRewards from "./claimRewards";
import delegate from "./delegate";
import unDelegate from "./unDelegate";
import transferToken, { sendRandToken } from "./transferToken";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { minutes, seconds } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";
import unStake from "./unStake";
import completeCampaign from "./completeCampaign";
import { HDNodeWallet, parseEther, Provider, Signer } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Gainz, Router } from "../../typechain-types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

function getStateFromError(errorMessage: string): number | null {
  const match = errorMessage.match(/state:\s*(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function extendArray<T>(baseArray: T[], targetLength: number): T[] {
  const extended = [...baseArray];
  while (extended.length < targetLength) {
    extended.push(getRandomItem(baseArray));
  }
  return extended;
}

function deriveHDWallet(phrase: string, index: number): HDNodeWallet {
  const hdNode = HDNodeWallet.fromPhrase(phrase);
  return hdNode.deriveChild(index);
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

async function fundIfNeeded(
  provider: Provider,
  account: HardhatEthersSigner,
  funder: Signer,
  nonce: number,
): Promise<number> {
  const balance = await provider.getBalance(account.address);

  if (balance < parseEther("0.000001")) {
    console.log(`Funding ${account.address}`);
    try {
      await funder.sendTransaction({
        to: account.address,
        value: parseEther("0.01"),
        nonce: nonce,
      });
      return nonce + 1;
    } catch (e: any) {
      console.error(e);
      const recovered = getStateFromError(e.message);
      return recovered ?? nonce;
    }
  }

  return nonce;
}

async function maybeSendRandomToken(
  feeTo: HardhatEthersSigner,
  recipient: string,
  hre: HardhatRuntimeEnvironment,
  nonce: number,
): Promise<number> {
  if (Math.random() > 0.7) {
    try {
      await sendRandToken(feeTo, recipient, hre, nonce);
      return nonce + 1;
    } catch (e: any) {
      console.error(e);
      const recovered = getStateFromError(e.message);
      return recovered ?? nonce;
    }
  }
  return nonce;
}

function logSuccess(count: number): void {
  if (count % 10 === 0) {
    console.log(`\n\nSuccessfully executed ${count} actions.\n`);
  }
}

function createMainnetActionFactory(actions: (typeof swap)[]) {
  return async (hre: HardhatRuntimeEnvironment) => {
    const { newFeeTo } = await hre.getNamedAccounts();
    const feeTo = await hre.ethers.getSigner(newFeeTo);
    let nonce = await hre.ethers.provider.getTransactionCount(feeTo.address);

    let queue: [() => Promise<void>, () => Promise<void>][] = [];
    let isRunning = false;
    let successCount = 0;

    return async (selectedAccounts: HardhatEthersSigner[]) => {
      const action = getRandomItem(actions);

      queue.push([
        async () => {
          for (const account of selectedAccounts) {
            await fundIfNeeded(hre.ethers.provider, account, feeTo, nonce).then(
              async _n =>
                randomInt(0, 10) > 7 &&
                (await maybeSendRandomToken(feeTo, account.address, hre, _n).then(_n => _n > nonce && (nonce = _n))),
            );
          }
        },
        () => action(hre, selectedAccounts).catch(console.error),
      ]);

      if (isRunning) {
        while (isRunning) await new Promise(res => setTimeout(res, 500));
        return;
      }

      isRunning = true;
      try {
        while (queue.length > 0) {
          const tasks = queue.shift();
          if (tasks) {
            tasks[1]();
            await tasks[0]();
          }
          successCount++;
          logSuccess(successCount);
        }
      } catch (err) {
        console.error("Error occurred while processing actions:", err);
      } finally {
        isRunning = false;
      }
    };
  };
}

// task("e2e", "").setAction(async (_, hre) => {
//   const actionPool = extendArray([stake, claimRewards, transferToken, unStake, ...Array(8).fill(swap)], 180);
//   const actions = shuffleArray(actionPool);

//   const isLocalhost = hre.network.name === "localhost";
//   const [startIndex, endIndex] = isLocalhost ? [4, 30] : [0, 2000];

//   const accounts = isLocalhost
//     ? await hre.ethers.getSigners()
//     : await Promise.all(
//         Array.from(
//           { length: endIndex + 1 },
//           (_, i) =>
//             deriveHDWallet(process.env.PRODUCTION_MNEMONIC!, i).connect(
//               hre.ethers.provider,
//             ) as unknown as HardhatEthersSigner,
//         ),
//       );

//   const mainnetAction = await createMainnetActionFactory(actions)(hre);

//   while (true) {
//     await Promise.all(
//       actions.map(async action => {
//         const accountStart = randomInt(startIndex, accounts.length);
//         const accountEnd = randomInt(accountStart + 1, accountStart + 30);
//         const selectedAccounts = accounts.slice(accountStart, accountEnd);

//         try {
//           if (isLocalhost) {
//             await action(hre, selectedAccounts);
//           } else {
//             await mainnetAction(selectedAccounts);
//           }
//         } catch (error: any) {
//           const message = error.toString();
//           const ignorable = [
//             "INSUFFICIENT_INPUT_AMOUNT",
//             "ECONNRESET",
//             "EADDRNOTAVAIL",
//             "other side closed",
//             "Timeout Error",
//             ...(isLocalhost ? [] : ["execution reverted", "nonce too low"]),
//           ];

//           if (!ignorable.some(err => message.includes(err))) {
//             throw error;
//           }

//           console.warn(`Ignored error from ${action.name}:`, message);
//         }
//       }),
//     );

//     if (isLocalhost) await time.increase(seconds(randomInt(1, 3600)));
//   }
// });

task("e2e", "").setAction(async (_, hre) => {
  const actions = shuffleArray([
    stake,
    swap,
    fundCampaign,
    claimRewards,
    delegate,
    unDelegate,
    transferToken,
    unStake,
    completeCampaign,
  ]);
  const isLocalhost = hre.network.name == "localhost";
  const [startIndex, endIndex] = isLocalhost ? [4, 30] : [0, 2000];
  const accounts = isLocalhost
    ? await hre.ethers.getSigners()
    : await Promise.all(
        new Array(endIndex + 1)
          .fill(0)
          .map((_, i) => deriveHDWallet(process.env.PRODUCTION_MNEMONIC!, i))
          .map(wallet => wallet.connect(hre.ethers.provider) as unknown as HardhatEthersSigner),
      );

  const mainnetActionFactory = async () => {
    const { newFeeTo } = await hre.getNamedAccounts();
    const feeTo = await hre.ethers.getSigner(newFeeTo);
    let nonce = await hre.ethers.provider.getTransactionCount(feeTo.address);

    let instances: any[] = []; // This will hold actions to be executed
    let actionInstances: any[] = []; // This will hold actions to be executed
    let isRunning = false; // Flag to track if processes are running

    let successCount = 0;

    // The returned function that adds tasks to the queue and processes them sequentially
    return async (selectedAccounts: HardhatEthersSigner[]) => {
      const action = getRandomItem(actions);

      // Add the action to the queue
      instances.push(async () => {
        for (const account of selectedAccounts) {
          // if (
          //   [
          //     "0x154aC1f4c67Ca3ec7dfED3Cd3dBF8b7DAe2EA2a7",
          //     "0x67888C04d7A78E0FE17Fb9664839E6e0C453ba79",
          //     "0x152b8e579A9AC09B85Cb5155fBAF221656baea5F",
          //     "0xB8169ed242c4a9Cd27577D3cDC04399fC9613AD3",
          //     "0x7144C6e959919074dC7694ebEc6eB291CF9B52f0",
          //     "0xB1a0eB91fE8A10f7Db2b79A8aC0AbDdC222Dd64D",
          //     "0x36576b09791F847f21Cf3948FC9eb7E412054B31",
          //     "0x706Be43061d8dEe22CA62c46b8A4ee0424CA9e37",
          //     "0x9B8F102c72b9b2d4C01A8c3e396A5c5f9863488D",
          //     "0x5636DE3Cc501073Cd53e690E4FB6E639a57a7629",
          //     "0x14A85122221Dace251342A5A630af0Ba30EC1A81",
          //   ].includes(account.address)
          // ) {
          //   const { ethers } = hre;
          //   const { deployer } = await hre.getNamedAccounts();

          //   const router = await ethers.getContract<Router>("Router", deployer);
          //   const governance = await ethers.getContractAt("Governance", await router.getGovernance());

          //   const gToken = await ethers.getContractAt("GToken", await governance.getGToken());
          //   const bals = await gToken.getGTokenBalance(account);
          //   for (const { nonce, amount } of bals) {
          //     await gToken.connect(account).safeTransferFrom(account, feeTo, nonce, amount, Buffer.from(""));
          //   }
          // }

          await hre.ethers.provider.getBalance(account.address).then(async bal => {
            // Fund the account if the balance is below the threshold
            if (bal < parseEther("0.001")) {
              console.log(`Funding ${account.address}`);
              return feeTo
                .sendTransaction({
                  to: account.address,
                  value: parseEther("0.01"),
                  nonce: ++nonce,
                })
                .catch(e => {
                  console.error(e);
                  const state = getStateFromError(e.message);
                  if (state) {
                    nonce = state;
                  } else {
                    nonce--;
                  }
                });
            }
          });
          // Randomly send tokens with a 30% chance
          // if (Math.random() > 0.7) {
          //  await sendRandToken(feeTo, account.address, hre, ++nonce).catch(e => {
          //     console.error(e);
          //     const state = getStateFromError(e.message);
          //     if (state) {
          //       nonce = state;
          //     } else {
          //       nonce--;
          //     }
          //   });
          // }

          // action(hre, [account]).catch(console.error);
        }

        actionInstances.push(() => action(hre, selectedAccounts));
      });

      // If processes are already running, we just return
      if (isRunning) {
        console.log("An action is already running. We're waiting for it to complete.");
        while (isRunning) {
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait for 0.5 second
        }
        console.log("Action completed. Now we can proceed.");

        return;
      }

      isRunning = true; // Set the flag to indicate that we are running

      // Execute each action in the queue synchronously
      try {
        // const pendingTasks: Promise<any>[] = [];

        while (instances.length || actionInstances.length) {
          const instance = instances.shift();
          const actionInstance = actionInstances.shift();

          if (instance) {
            await instance().catch(console.error);
            // pendingTasks.push(instance().catch(console.error));
          }

          if (actionInstance) {
            actionInstance().catch(console.error);
            // pendingTasks.push(actionInstance().catch(console.error));
          }
          successCount++;
          if (successCount % 10 === 0) {
            console.log(`\n\n\n\n\n\n\n\n\n\nSuccessfully executed ${successCount} actions.\n\n\n\n\n\n\n\n\n\n`);
          }
        }

        // await Promise.all(pendingTasks);
      } catch (error) {
        console.error("Error occurred while processing actions:", error);
      } finally {
        isRunning = false; // Reset the flag once all actions are complete
      }
    };
  };

  const mainnetAction = await mainnetActionFactory();

  while (true) {
    await Promise.all(
      actions.map(async action => {
        const accountStart = randomNumber(startIndex, accounts.length);
        const accountEnd = randomNumber(accountStart + 1, accountStart + 30);
        const selectedAccounts = accounts.slice(accountStart, accountEnd);

        try {
          if (!isLocalhost) {
            await mainnetAction(selectedAccounts);
          } else {
            await action(hre, selectedAccounts);
          }
        } catch (error: any) {
          console.log("runing", action.name);

          if (
            ![
              "INSUFFICIENT_INPUT_AMOUNT",
              "ECONNRESET",
              "EADDRNOTAVAIL",
              "other side closed",
              "Timeout Error",
              ...(!isLocalhost ? ["execution reverted", "nonce too low"] : []),
            ].some(errString => error.toString().includes(errString))
          ) {
            throw error;
          }

          console.log(error);
        }
      }),
    );

    isLocalhost && (await time.increase(seconds(randomNumber(1, 3_600))));
  }
});
