// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./Base.sol";
import {TestToken} from "../../src/TestToken.sol";
import {TestStaking} from "../../src/TestStaking.sol";

/// @dev Token whose transfer/transferFrom return false without moving funds.
contract FalseToken {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

/// @dev Token that re-enters the staking contract during transfers.
contract ReentrantToken {
    TestStaking public target;
    bool public reenterWithdraw;

    function setTarget(TestStaking t, bool w) external {
        target = t;
        reenterWithdraw = w;
    }

    function transferFrom(address, address, uint256) external returns (bool) {
        if (!reenterWithdraw) target.stake(1);
        return true;
    }

    function transfer(address, uint256) external returns (bool) {
        target.withdraw(1);
        return true;
    }
}

contract TestStakingTest is TestBase {
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    uint256 internal constant P = 1e18; // one point
    TestToken internal tok;
    TestStaking internal st;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA201);
    uint256 internal t0 = 1_700_000_000;

    function setUp() public {
        vm.warp(t0);
        tok = new TestToken();
        st = new TestStaking(address(tok));
        address[3] memory us = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            tok.transfer(us[i], 100_000e18);
            vm.prank(us[i]);
            tok.approve(address(st), type(uint256).max);
        }
    }

    function _stake(address u, uint256 a) internal {
        vm.prank(u);
        st.stake(a);
    }

    function _withdraw(address u, uint256 a) internal {
        vm.prank(u);
        st.withdraw(a);
    }

    function test_bindings() public view {
        assertTrue(st.token() == address(tok), "token");
        assertEq(st.totalStaked(), 0, "total");
        assertEq(st.ACC_PRECISION(), 1e36, "precision");
    }

    function test_constructorRejectsNonContract() public {
        vm.expectRevert(TestStaking.InvalidToken.selector);
        new TestStaking(alice);
    }

    function test_stakeMovesTokensAndEmits() public {
        vm.expectEmit(true, false, false, true, address(st));
        emit Staked(alice, 10e18);
        _stake(alice, 10e18);
        assertEq(st.stakedOf(alice), 10e18, "stakedOf");
        assertEq(st.totalStaked(), 10e18, "total");
        assertEq(tok.balanceOf(address(st)), 10e18, "held");
        assertEq(tok.balanceOf(alice), 100_000e18 - 10e18, "alice bal");
    }

    function test_zeroAmountsRevert() public {
        vm.expectRevert(TestStaking.ZeroAmount.selector);
        _stake(alice, 0);
        _stake(alice, 1);
        vm.expectRevert(TestStaking.ZeroAmount.selector);
        _withdraw(alice, 0);
    }

    function test_stakeWithoutAllowanceReverts() public {
        address dave = address(0xDA5E);
        tok.transfer(dave, 1e18);
        vm.expectRevert(TestStaking.TransferFailed.selector);
        _stake(dave, 1e18);
        assertEq(st.totalStaked(), 0, "state rolled back");
    }

    function test_stakeMoreThanBalanceReverts() public {
        vm.expectRevert(TestStaking.TransferFailed.selector);
        _stake(alice, 100_000e18 + 1);
    }

    function test_singleStakerAccrual() public {
        _stake(alice, 5e18);
        vm.warp(t0 + 100);
        assertEq(st.pointsOf(alice), 100 * P, "1 point/sec");
    }

    function test_proportionalShares() public {
        _stake(alice, 1e18);
        _stake(bob, 3e18);
        vm.warp(t0 + 100);
        assertEq(st.pointsOf(alice), 25 * P, "alice 1/4");
        assertEq(st.pointsOf(bob), 75 * P, "bob 3/4");
    }

    function test_shareChangesOverTime() public {
        _stake(alice, 10e18);
        vm.warp(t0 + 10); // alice alone: 10
        _stake(bob, 10e18);
        vm.warp(t0 + 20); // split 5/5
        _stake(carol, 20e18);
        vm.warp(t0 + 40); // 1/4,1/4,1/2 of 20 -> 5,5,10
        assertEq(st.pointsOf(alice), 20 * P, "alice");
        assertEq(st.pointsOf(bob), 10 * P, "bob");
        assertEq(st.pointsOf(carol), 10 * P, "carol");
    }

    function test_emptyIntervalBeforeFirstStake() public {
        vm.warp(t0 + 1000);
        _stake(alice, 1e18);
        assertEq(st.pointsOf(alice), 0, "nothing for empty period");
        vm.warp(t0 + 1010);
        assertEq(st.pointsOf(alice), 10 * P, "only active time");
    }

    function test_emptyIntervalBetweenStakes() public {
        _stake(alice, 1e18);
        vm.warp(t0 + 10);
        _withdraw(alice, 1e18);
        vm.warp(t0 + 1000); // empty: nobody earns
        _stake(bob, 1e18);
        vm.warp(t0 + 1005);
        assertEq(st.pointsOf(alice), 10 * P, "alice kept");
        assertEq(st.pointsOf(bob), 5 * P, "bob no backfill");
    }

    function test_partialWithdraw() public {
        _stake(alice, 100e18);
        vm.warp(t0 + 10);
        vm.expectEmit(true, false, false, true, address(st));
        emit Withdrawn(alice, 50e18);
        _withdraw(alice, 50e18);
        assertEq(st.stakedOf(alice), 50e18, "remaining");
        assertEq(tok.balanceOf(alice), 100_000e18 - 50e18, "returned");
        _stake(bob, 50e18);
        vm.warp(t0 + 20);
        assertEq(st.pointsOf(alice), 15 * P, "alice 10 + 5");
        assertEq(st.pointsOf(bob), 5 * P, "bob");
    }

    function test_fullWithdrawPreservesPoints() public {
        _stake(alice, 7e18);
        vm.warp(t0 + 30);
        _withdraw(alice, 7e18);
        assertEq(st.stakedOf(alice), 0, "zero stake");
        assertEq(st.totalStaked(), 0, "total");
        assertEq(tok.balanceOf(alice), 100_000e18, "all back");
        vm.warp(t0 + 1000);
        uint256 pts = st.pointsOf(alice);
        // 30e54 / 7e18 is not exact: accrual rounds down by at most 1 base unit
        assertTrue(pts <= 30 * P, "never rounds up");
        assertApprox(pts, 30 * P, 1, "points preserved, no more accrual");
        vm.warp(t0 + 5000);
        assertEq(st.pointsOf(alice), pts, "unchanged after withdrawal");
    }

    function test_restake() public {
        _stake(alice, 1e18);
        vm.warp(t0 + 10);
        _withdraw(alice, 1e18);
        vm.warp(t0 + 50);
        _stake(alice, 2e18);
        vm.warp(t0 + 60);
        _stake(alice, 2e18); // top-up settles first
        vm.warp(t0 + 70);
        assertEq(st.pointsOf(alice), 30 * P, "10 + 10 + 10");
        assertEq(st.stakedOf(alice), 4e18, "stake");
    }

    function test_simultaneousEventsSameTimestamp() public {
        _stake(alice, 1e18);
        _stake(bob, 1e18);
        _withdraw(alice, 1e18);
        _stake(alice, 1e18);
        _stake(carol, 2e18);
        assertEq(st.pointsOf(alice), 0, "no time elapsed");
        vm.warp(t0 + 4);
        assertEq(st.pointsOf(alice), 1 * P, "alice 1/4");
        assertEq(st.pointsOf(bob), 1 * P, "bob 1/4");
        assertEq(st.pointsOf(carol), 2 * P, "carol 1/2");
        _withdraw(carol, 2e18);
        _stake(carol, 2e18);
        _withdraw(bob, 1e18);
        vm.warp(t0 + 7);
        assertEq(st.pointsOf(alice), 2 * P, "alice 1/3 of 3");
        assertEq(st.pointsOf(bob), 1 * P, "bob stopped");
        assertEq(st.pointsOf(carol), 4 * P, "carol 2/3 of 3");
    }

    function test_unauthorizedWithdrawReverts() public {
        _stake(alice, 5e18);
        vm.expectRevert(abi.encodeWithSelector(TestStaking.InsufficientStake.selector, 0, 1));
        _withdraw(bob, 1);
        assertEq(st.stakedOf(alice), 5e18, "alice untouched");
    }

    function test_withdrawMoreThanStakedReverts() public {
        _stake(alice, 5e18);
        vm.expectRevert(abi.encodeWithSelector(TestStaking.InsufficientStake.selector, 5e18, 5e18 + 1));
        _withdraw(alice, 5e18 + 1);
    }

    function test_roundingNeverOverIssues() public {
        _stake(alice, 1);
        _stake(bob, 1);
        _stake(carol, 1);
        vm.warp(t0 + 1);
        uint256 a = st.pointsOf(alice);
        uint256 b = st.pointsOf(bob);
        uint256 c = st.pointsOf(carol);
        assertEq(a, b, "equal shares");
        assertEq(b, c, "equal shares");
        assertTrue(a + b + c <= P, "no over-issuance");
        assertApprox(a + b + c, P, 3, "dust bounded");
    }

    function test_roundingUnevenLargeStakes() public {
        _stake(alice, 1);
        _stake(bob, 99_999e18);
        vm.warp(t0 + 7);
        uint256 a = st.pointsOf(alice);
        uint256 b = st.pointsOf(bob);
        assertTrue(a + b <= 7 * P, "no over-issuance");
        assertApprox(a + b, 7 * P, 2, "dust bounded");
        // alice's exact share 7e18 / (99_999e18 + 1) ~ 7e-5 base units -> rounds to 0
        assertEq(a, 0, "tiny share rounds down");
    }

    function test_settledEqualsViewed() public {
        _stake(alice, 3e18);
        _stake(bob, 7e18);
        vm.warp(t0 + 13);
        uint256 viewed = st.pointsOf(alice);
        _stake(alice, 1); // forces settlement
        assertEq(st.pointsOf(alice), viewed, "settlement matches view");
    }

    function test_noOverflowLongTinyStakeThenLarge() public {
        _stake(alice, 1);
        vm.warp(t0 + 100 * 365 days);
        _stake(bob, 100_000e18);
        vm.warp(t0 + 100 * 365 days + 10);
        assertApprox(st.pointsOf(alice), 100 * 365 days * P, 10, "alice ~ all of first period");
        assertApprox(st.pointsOf(bob), 10 * P, 1, "bob ~ all of last 10s");
        _withdraw(bob, 100_000e18);
        _withdraw(alice, 1);
    }

    function test_falseReturningTokenRejected() public {
        FalseToken f = new FalseToken();
        TestStaking s = new TestStaking(address(f));
        vm.expectRevert(TestStaking.TransferFailed.selector);
        s.stake(1);
        assertEq(s.totalStaked(), 0, "nothing recorded");
    }

    function test_reentrancyOnStakeBlocked() public {
        ReentrantToken r = new ReentrantToken();
        TestStaking s = new TestStaking(address(r));
        r.setTarget(s, false);
        vm.expectRevert(TestStaking.TransferFailed.selector); // inner Reentrancy bubbles as failed call
        s.stake(1);
    }

    function test_reentrancyOnWithdrawBlocked() public {
        ReentrantToken r = new ReentrantToken();
        TestStaking s = new TestStaking(address(r));
        r.setTarget(s, true);
        s.stake(5); // transferFrom does not re-enter in this mode
        vm.expectRevert(TestStaking.TransferFailed.selector); // transfer re-enters withdraw -> blocked
        s.withdraw(5);
        assertEq(s.stakedOf(address(this)), 5, "rolled back");
    }

    function test_noAdminSurface() public {
        (bool ok,) = address(st).call(abi.encodeWithSignature("owner()"));
        assertTrue(!ok, "no owner");
        (ok,) = address(st).call(abi.encodeWithSignature("upgradeTo(address)", alice));
        assertTrue(!ok, "no upgrade");
    }

    function testFuzz_twoStakersConserve(uint96 a, uint96 b, uint32 dt) public {
        uint256 sa = uint256(a) % 100_000e18 + 1;
        uint256 sb = uint256(b) % 100_000e18 + 1;
        uint256 d = uint256(dt) % (10 * 365 days) + 1;
        _stake(alice, sa);
        _stake(bob, sb);
        vm.warp(t0 + d);
        uint256 pa = st.pointsOf(alice);
        uint256 pb = st.pointsOf(bob);
        assertTrue(pa + pb <= d * P, "no over-issuance");
        assertApprox(pa + pb, d * P, 2, "conservation");
        assertApprox(pa, (d * P * sa) / (sa + sb), 1, "pro rata");
    }
}
