// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Epochs } from "./Epochs.sol";
import { Governance } from "../Governance.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

library DeployGovernance {
	function create(
		Epochs.Storage memory epochs,
		address gainzToken,
		address wNativeToken,
		address proxyAdmin
	) external returns (address) {
		// Deploy the TransparentUpgradeableProxy and initialize the Governance contract
		return
			address(
				new TransparentUpgradeableProxy(
					address(new Governance()),
					proxyAdmin,
					abi.encodeWithSelector(
						Governance.initialize.selector,
						epochs,
						gainzToken,
						wNativeToken,
						proxyAdmin
					)
				)
			);
	}
}
