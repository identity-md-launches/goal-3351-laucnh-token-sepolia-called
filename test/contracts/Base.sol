// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Minimal, self-contained subset of the Foundry cheatcode interface (no forge-std).
interface Vm {
    function warp(uint256 newTimestamp) external;
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert() external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter)
        external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 a, uint256 b, string memory why) internal pure {
        if (a != b) revert(string.concat(why, ": ", _u(a), " != ", _u(b)));
    }

    function assertTrue(bool c, string memory why) internal pure {
        if (!c) revert(why);
    }

    function assertApprox(uint256 a, uint256 b, uint256 tol, string memory why) internal pure {
        uint256 d = a > b ? a - b : b - a;
        if (d > tol) revert(string.concat(why, ": ", _u(a), " !~ ", _u(b)));
    }

    function _u(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        for (uint256 t = v; t != 0; t /= 10) len++;
        bytes memory b = new bytes(len);
        while (v != 0) {
            b[--len] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(b);
    }
}
