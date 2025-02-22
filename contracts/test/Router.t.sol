// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestERC20 } from "./TestERC20.sol";
import { RouterFixture } from "./shared/RouterFixture.sol";
import { Pair } from "../Pair.sol";
import { TokenPayment } from "../libraries/TokenPayments.sol";
import { Router } from "../Router.sol";

contract RouterTest is Test, RouterFixture {
	Pair pair;
	TestERC20 token0;
	TestERC20 token1;

	function setUp() public {
		wNative.setYuzuAggregator(address(899999));
	}

	function setUpNativeAndERC20Pair() public {
		TestERC20 erc20Token = new TestERC20("ERC20_token", "TK", 18);
		erc20Token.mint(address(this), 1000 ether);

		TokenPayment memory paymentA = TokenPayment({
			token: address(erc20Token),
			amount: 100 ether,
			nonce: 0
		});
		TokenPayment memory paymentB = TokenPayment({
			token: address(wNative),
			amount: 10 ether,
			nonce: 0
		});

		wNative.receiveForSpender{ value: paymentB.amount }(
			address(this),
			address(router)
		);
		erc20Token.approve(address(router), 1000 ether);
		(address pairAddress, ) = router.createPair{ value: paymentB.amount }(
			paymentA,
			paymentB
		);
		pair = Pair(pairAddress);

		token0 = TestERC20(pair.token0());
		token1 = TestERC20(pair.token1());
	}

	function beforeTestSetup(
		bytes4 testSelector
	) public pure returns (bytes[] memory beforeTestCalldata) {
		if (testSelector == this.testERC20RegisterAndSwap.selector) {
			beforeTestCalldata = new bytes[](1);
			beforeTestCalldata[0] = abi.encodePacked(
				this.setUpNativeAndERC20Pair.selector
			);
		}
	}

	function testERC20RegisterAndSwap() public {
		address[] memory path = new address[](2);
		path[1] = router.getWrappedNativeToken();
		path[0] = path[1] == address(token0)
			? address(token1)
			: address(token0);

		bytes memory swapData = abi.encodeWithSelector(
			Router.swapExactTokensForTokens.selector,
			1 ether,
			1 wei,
			path,
			address(this),
			block.timestamp + 1000
		);

		TestERC20(path[0]).approve(address(router), 1 ether);

		router.registerAndSwap(0, swapData);
		assertEq(router.getUserId(address(this)), 1);
	}

	receive() external payable {}
}
