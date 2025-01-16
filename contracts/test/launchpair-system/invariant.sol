// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";

import { SystemHandler } from "./handler.sol";

contract SystemInvariantTest is Test {
	SystemHandler handler;

	function setUp() external {
		handler = new SystemHandler();

		bytes4[] memory selectors = new bytes4[](0);

		targetSelector(
			FuzzSelector({ addr: address(handler), selectors: selectors })
		);
        
		targetContract(address(handler));
	}
}
