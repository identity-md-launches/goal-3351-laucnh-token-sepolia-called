// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./Base.sol";
import {TestToken} from "../../src/TestToken.sol";

contract TestTokenTest is TestBase {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    TestToken internal t;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        t = new TestToken();
    }

    function test_metadata() public view {
        assertTrue(keccak256(bytes(t.name())) == keccak256("test"), "name");
        assertTrue(keccak256(bytes(t.symbol())) == keccak256("test"), "symbol");
        assertEq(t.decimals(), 18, "decimals");
    }

    function test_initialSupplyToDeployer() public {
        assertEq(t.totalSupply(), 1_000_000e18, "supply");
        assertEq(t.balanceOf(address(this)), 1_000_000e18, "deployer balance");
        vm.prank(alice);
        TestToken t2 = new TestToken();
        assertEq(t2.balanceOf(alice), 1_000_000e18, "msg.sender gets supply");
        assertEq(t2.balanceOf(address(this)), 0, "nobody else");
    }

    function test_constructorEmitsTransfer() public {
        vm.expectEmit(true, true, false, true);
        emit Transfer(address(0), address(this), 1_000_000e18);
        new TestToken();
    }

    function test_faucetMintMax() public {
        vm.expectEmit(true, true, false, true, address(t));
        emit Transfer(address(0), alice, 1_000e18);
        vm.prank(alice);
        t.mint(1_000e18);
        assertEq(t.balanceOf(alice), 1_000e18, "alice");
        assertEq(t.totalSupply(), 1_001_000e18, "supply");
    }

    function test_faucetMintOneWei() public {
        vm.prank(alice);
        t.mint(1);
        assertEq(t.balanceOf(alice), 1, "1 wei");
    }

    function test_faucetRepeatedCalls() public {
        vm.startPrank(alice);
        t.mint(1_000e18);
        t.mint(1_000e18);
        vm.stopPrank();
        assertEq(t.balanceOf(alice), 2_000e18, "per-call limit");
    }

    function test_faucetRejectsZero() public {
        vm.expectRevert(abi.encodeWithSelector(TestToken.InvalidMintAmount.selector, 0));
        t.mint(0);
    }

    function test_faucetRejectsAboveLimit() public {
        vm.expectRevert(abi.encodeWithSelector(TestToken.InvalidMintAmount.selector, 1_000e18 + 1));
        t.mint(1_000e18 + 1);
    }

    function test_transfer() public {
        vm.expectEmit(true, true, false, true, address(t));
        emit Transfer(address(this), alice, 5e18);
        assertTrue(t.transfer(alice, 5e18), "ret");
        assertEq(t.balanceOf(alice), 5e18, "alice");
        assertEq(t.balanceOf(address(this)), 1_000_000e18 - 5e18, "sender");
    }

    function test_transferInsufficient() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestToken.InsufficientBalance.selector, 0, 1));
        t.transfer(bob, 1);
    }

    function test_transferToZeroReverts() public {
        vm.expectRevert(abi.encodeWithSelector(TestToken.InvalidReceiver.selector, address(0)));
        t.transfer(address(0), 1);
    }

    function test_approveAndTransferFrom() public {
        vm.expectEmit(true, true, false, true, address(t));
        emit Approval(address(this), alice, 10e18);
        assertTrue(t.approve(alice, 10e18), "approve");
        assertEq(t.allowance(address(this), alice), 10e18, "allowance");
        vm.prank(alice);
        assertTrue(t.transferFrom(address(this), bob, 4e18), "tf");
        assertEq(t.balanceOf(bob), 4e18, "bob");
        assertEq(t.allowance(address(this), alice), 6e18, "allowance left");
    }

    function test_transferFromInsufficientAllowance() public {
        t.approve(alice, 1e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestToken.InsufficientAllowance.selector, 1e18, 1e18 + 1));
        t.transferFrom(address(this), bob, 1e18 + 1);
    }

    function test_transferFromNoAllowance() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestToken.InsufficientAllowance.selector, 0, 1));
        t.transferFrom(address(this), bob, 1);
    }

    function test_infiniteAllowanceNotDecremented() public {
        t.approve(alice, type(uint256).max);
        vm.prank(alice);
        t.transferFrom(address(this), bob, 7);
        assertEq(t.allowance(address(this), alice), type(uint256).max, "max stays");
    }

    function test_approveOverwrite() public {
        t.approve(alice, 5);
        t.approve(alice, 0);
        assertEq(t.allowance(address(this), alice), 0, "reset");
    }

    function test_noOwnerFunctions() public {
        (bool ok,) = address(t).call(abi.encodeWithSignature("owner()"));
        assertTrue(!ok, "no owner()");
    }
}
