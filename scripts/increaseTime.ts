import { time } from "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";

task("increaseTime", "Move time fowards")
  .addParam("seconds", "Number of seconds to add")
  .setAction(async ({ seconds }, hre) => {
    await time.increase(+seconds);
  });
