import { time } from "@nomicfoundation/hardhat-network-helpers";
import { hours, minutes, days, years } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";
import "@nomicfoundation/hardhat-toolbox";
import { task } from "hardhat/config";

task("moveTime", "")
  .addParam("unit", "h? m? or s")
  .addParam("amount", "The number of unit")
  .setAction(async ({ unit, amount }, hre) => {
    if (hre.network.name != "localhost") {
      throw new Error("Only works in localhost");
    }

    const seconds =
      unit == "h"
        ? hours(amount)
        : unit == "m"
          ? minutes(amount)
          : unit == "d"
            ? days(amount)
            : unit == "y"
              ? years(amount)
              : Number(amount);

    await time.increase(seconds);
  });
