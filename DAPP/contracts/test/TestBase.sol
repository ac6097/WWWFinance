// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface Vm {
    function warp(uint256 timestamp) external;
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function makeAddr(string memory name) internal pure returns (address) {
        return address(uint160(uint256(keccak256(bytes(name)))));
    }

    function assertEq(uint256 left, uint256 right) internal pure {
        require(left == right, "uint values differ");
    }

    function assertEq(address left, address right) internal pure {
        require(left == right, "addresses differ");
    }

    function assertEq(string memory left, string memory right) internal pure {
        require(keccak256(bytes(left)) == keccak256(bytes(right)), "strings differ");
    }

    function assertTrue(bool value) internal pure {
        require(value, "expected true");
    }
}
