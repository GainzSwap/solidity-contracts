// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { PriceOracle } from "../PriceOracle.sol";

library DeployPriceOracle {
	function create() external returns (address oracle) {
		oracle = address(
			new PriceOracle{
				salt: keccak256(abi.encodePacked(address(this)))
			}()
		);
	}
}
