// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @dev Minimal single-owner access control — replaces OpenZeppelin
/// OwnableUpgradeable in the adapted vTPM contracts (no proxies here).
abstract contract Ownable {
    address public owner;

    error NotOwner();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address initialOwner) {
        require(initialOwner != address(0), "zero owner");
        owner = initialOwner;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
