import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";
import swap from "./swap";
import stake from "./stake";
import { getRandomItem, randomNumber, shuffleArray, sleep } from "../../utilities";
import fundCampaign from "./fundCampaign";
import claimRewards from "./claimRewards";
import delegate from "./delegate";
import unDelegate from "./unDelegate";
import transferToken, { sendToken } from "./transferToken";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { seconds } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";
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
  if (Math.random() > 0.55) {
    try {
      const { ethers } = hre;
      const { deployer } = await hre.getNamedAccounts();

      const router = await ethers.getContract<Router>("Router", deployer);
      const gainz = await ethers.getContract<Gainz>("Gainz", deployer);
      const wnative = await ethers.getContractAt("WNTV", await router.getWrappedNativeToken());

      await sendToken(getRandomItem([gainz, wnative]), feeTo, recipient);
      return nonce + 1;
    } catch (e: any) {
      console.error(e);
      const recovered = getStateFromError(e.message);
      return recovered ?? nonce;
    }
  }
  return nonce;
}

task("e2e", "")
  .addFlag("fund")
  .setAction(async ({ fund }, hre) => {
    const actions = extendArray(
      [
        stake,
        ...extendArray([swap], 5),
        fundCampaign,
        claimRewards,
        delegate,
        unDelegate,
        transferToken,
        unStake,
        completeCampaign,
      ],
      30,
    );
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

    let txsRunning = 0;
    while (true) {
      if (txsRunning >= 30) {
        console.log("Waiting for txs to finish...", txsRunning);
        await sleep(1000);
        continue;
      }

      try {
        if (!Boolean(fund)) {
          const runs = shuffleArray(actions).slice(0, 3);

          Promise.all(
            runs
              .map(async action => {
                const selected = await getSelected();
                txsRunning += selected.length;

                return selected.map(acc =>
                  action(hre, [acc])
                    .catch(console.log)
                    .finally(() => {
                      txsRunning -= 1;
                    }),
                );
              })
              .flatMap(x => x),
            // .slice(0, 30),
          ).catch(e => {
            console.error(e);
          });
        } else {
          for (const account of await getSelected()) {
            await fundIfNeeded(hre.ethers.provider, account, feeTo, 0).then(async _n =>
              maybeSendRandomToken(feeTo, account.address, hre, _n),
            );
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
  });
