// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { dEDU } from "../tokens/WNTV.sol";

library DeployWNTV {
	function create(address proxyAdmin) external returns (address) {
		return
			address(
				new TransparentUpgradeableProxy(
					address(new dEDU()),
					proxyAdmin,
					abi.encodeWithSignature("initialize()")
				)
			);
	}
}
