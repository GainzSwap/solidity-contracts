import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import swap from "./swap";
import stake from "./stake";
import { randomNumber, sequentialRun, shuffleArray, sleep } from "../../utilities";
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

function getStateFromError(errorMessage: string): number | null {
  const match = errorMessage.match(/state:\s*(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function deriveHDWallet(phrase: string, index: number): HDNodeWallet {
  const hdNode = HDNodeWallet.fromPhrase(phrase);
  return hdNode.deriveChild(index);
}

async function fundIfNeeded(
  provider: Provider,
  account: HardhatEthersSigner,
  funder: Signer,
  nonce: number,
): Promise<number> {
  const balance = await provider.getBalance(account.address);

  if (balance < parseEther("0.0001")) {
    console.log(`Funding ${account.address}`);
    try {
      await funder.sendTransaction({
        to: account.address,
        value: parseEther("0.01"),
        nonce: nonce || undefined,
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
      fundCampaign,
      claimRewards,
      delegate,
      unDelegate,
      transferToken,
      unStake,
      completeCampaign,
    ];

    const isLocalhost = hre.network.name == "localhost";
    const [startIndex, endIndex] = isLocalhost ? [4, 30] : [0, 3500];

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
    const getSelected = async () => {
      const accountStart = randomNumber(startIndex, endIndex);
      const accountEnd = randomNumber(accountStart + 1, accountStart + 30);

      return accounts.slice(accountStart, accountEnd);
    };

    await Promise.all(new Array(numWorkers).fill(0).map(() => e2e(hre, fund, actions, feeTo, accounts, getSelected)));
  });

let runs = 0;
async function e2e(
  hre: HardhatRuntimeEnvironment,
  fund: boolean,
  actions: (typeof swap)[],
  feeTo: HardhatEthersSigner,
  accounts: HardhatEthersSigner[],
  getSelected: () => Promise<HardhatEthersSigner[]>,
  isLocalhost = hre.network.name == "localhost",
) {
  const run = runs++;
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

    const selected = await getSelected();

    try {
      if (!Boolean(fund)) {
        const runs = shuffleArray(actions);

        Promise.all(
          runs
            .map(async action => {
              txsRunning += selected.length;

              return selected.map(async acc => {
                const run = () => action(hre, [acc]);
                try {
                  await run();
                } catch (error: any) {
                  if (error.toString().includes("gas + fee")) {
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
                        } catch (error) {
                          // const err = error?.toString();
                          // if (err?.includes("nonce too low") || err?.includes("nonce too high")) {
                          //   rerun = true;
                          //   console.log("Rerun funding", acc.address);
                          // }
                        }
                      } while (rerun);
                    });

                    await run().catch(console.error);
                  }
                } finally {
                  txsRunning -= 1;
                }
              });
            })
            .flatMap(x => x),
          // .slice(0, 30),
        ).catch(e => {
          console.error(e);
        });
      } else {
        for (const acount of shuffleArray(accounts)) {
          await fundIfNeeded(hre.ethers.provider, acount, feeTo, 0);
        }
      }
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
