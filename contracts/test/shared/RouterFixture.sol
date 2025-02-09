// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import { Router } from "../../Router.sol";
import { Gainz } from "../../tokens/Gainz/Gainz.sol";
import { dEDU } from "../../tokens/WNTV.sol";

abstract contract RouterFixture {
	Router router;
	Gainz gainz;
	dEDU wNative;

	constructor() {
		gainz = new Gainz();
		gainz.initialize();

		router = new Router();
		router.initialize(address(this), address(gainz));
		router.setPriceOracle();

		wNative = dEDU(payable(router.getWrappedNativeToken()));
	}
}
