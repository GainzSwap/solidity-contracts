// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Epochs } from "./Epochs.sol";
import { Governance } from "../Governance.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { GToken } from "../tokens/GToken/GToken.sol";

library DeployGToken {
	function create(
		Epochs.Storage memory epochs,
		address initialOwner,
		address proxyAdmin
	) external returns (address) {
		return
			address(
				new TransparentUpgradeableProxy(
					address(new GToken()),
					proxyAdmin,
					abi.encodeWithSelector(
						GToken.initialize.selector,
						epochs,
						initialOwner
					)
				)
			);
	}
}
