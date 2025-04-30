import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import swap from "./swap";
import stake from "./stake";
import {
  deriveHDWallet,
  extendArray,
  fundIfNeeded,
  randomNumber,
  sequentialRun,
  shuffleArray,
  sleep,
} from "../../utilities";
import fundCampaign from "./fundCampaign";
import claimRewards from "./claimRewards";
import delegate from "./delegate";
import unDelegate from "./unDelegate";
import transferToken from "./transferToken";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { seconds } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";
import unStake from "./unStake";
import completeCampaign from "./completeCampaign";
import { HDNodeWallet, parseEther, Provider, Signer } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import os from "os";

task("e2e", "Run E2E tests")
  .addFlag("fund", "Fund accounts before running tests")
  .addOptionalParam("workers", "Number of worker processes to spawn", undefined)
  .setAction(async ({ fund, workers }, hre) => {
    const cpus = os.cpus().length;
    const maxWorkers = Math.max(1, Math.floor(cpus / 2));

    let numWorkers = workers ?? 1; // Default to 1 if not specified

    if (numWorkers > maxWorkers) {
      console.log(
        `⚠️  Requested workers (${numWorkers}) exceeds max allowed (${maxWorkers}). Using ${maxWorkers} workers.`,
      );
      numWorkers = maxWorkers;
    }

    console.log(`Using ${numWorkers} worker(s)`);

    const actions = [
      stake,
      swap,
      swap,
      swap,
      // fundCampaign,
      // claimRewards,
      // delegate,
      // unDelegate,
      // transferToken,
      // unStake,
      // completeCampaign,
    ];

    const isLocalhost = hre.network.name == "localhost";
    const [startIndex, endIndex] = isLocalhost ? [4, 30] : [0, 99];

    const accounts = isLocalhost
      ? await hre.ethers.getSigners()
      : await Promise.all(
          new Array(endIndex + 1)
            .fill(0)
            .map((_, i) => deriveHDWallet(process.env.PRODUCTION_MNEMONIC!, i))
            .map(wallet => wallet.connect(hre.ethers.provider) as unknown as HardhatEthersSigner),
        );

    const { newFeeTo } = await hre.getNamedAccounts();
    const feeTo = await hre.ethers.getSigner(newFeeTo);
    const getSelected = () => {
      return shuffleArray(accounts).slice(0, Math.floor(60 / actions.length) || 1);
    };

    const runs = Array.from({ length: numWorkers }, (_, run) =>
      e2e(hre, fund, actions, feeTo, accounts, getSelected, run),
    );

    console.log("Starting E2E tests...", runs.length);
    await sleep(1000);

    await Promise.all(runs);
  });

async function e2e(
  hre: HardhatRuntimeEnvironment,
  fund: boolean,
  actions: (typeof swap)[],
  feeTo: HardhatEthersSigner,
  accounts: HardhatEthersSigner[],
  getSelected: () => HardhatEthersSigner[],
  run = 0,
) {
  const isLocalhost = hre.network.name == "localhost";

  console.log("Starting E2E test", run);
  // Graceful exit handler
  const shutdown = () => {
    console.log(`Worker ${run} shutting down...`);
    process.exit(0);
  };

  // Listen for termination signals
  process.on("SIGINT", shutdown); // ctrl+C
  process.on("SIGTERM", shutdown); // kill or system shutdown
  process.on("message", msg => {
    if (msg === "shutdown") {
      shutdown();
    }
  });

  let txsRunning = 0;
  while (true) {
    if (txsRunning >= 30) {
      console.log("Waiting for txs to finish...", { txsRunning, run });
      await sleep(1000);
      continue;
    }

    try {
      const runs = shuffleArray(actions);

      Promise.all(
        runs
          .map(action => {
            return getSelected().map(async acc => {
              txsRunning += 1;
              const run = () => action(hre, [acc], fund);
              try {
                await run();
              } catch (error: any) {
                if (error.toString().includes("gas + fee") && fund) {
                  await sequentialRun(feeTo, async seqAcc => {
                    let rerun = false;
                    do {
                      try {
                        await fundIfNeeded(
                          hre.ethers.provider,
                          acc,
                          seqAcc,
                          await hre.ethers.provider.getTransactionCount(seqAcc),
                        );
                        rerun = false;
                      } catch (error) {
                        const err = error?.toString();
                        if (err?.includes("nonce too low") || err?.includes("nonce too high")) {
                          rerun = true;
                          console.log("Rerun funding", acc.address);
                        } else {
                          rerun = false;
                        }
                      }
                    } while (rerun);
                  });

                  await run().catch(console.log);
                }
              } finally {
                // await hre.run("pointsAccrual", { address: acc.address });
                txsRunning -= 1;
              }
            });
          })
          .flatMap(x => x)
          .slice(0, 50),
      ).catch(e => {
        console.error(e);
      });
    } catch (error: any) {
      if (
        ![
          "INSUFFICIENT_INPUT_AMOUNT",
          "ECONNRESET",
          "EADDRNOTAVAIL",
          "other side closed",
          "Timeout Error",
          ...(!isLocalhost
            ? [
                "execution reverted",
                "nonce too low",
                "insufficient funds for gas",
                "Too Many Requests error received from rpc.edu-chain.raas.gelato.cloud",
              ]
            : []),
        ].some(errString => error.toString().includes(errString))
      ) {
        throw error;
      }

      console.log(error);
    }

    isLocalhost && (await time.increase(seconds(randomNumber(1, 3_600))));
  }
}
