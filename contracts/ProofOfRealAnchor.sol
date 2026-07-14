// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * ProofOfRealAnchor — anchors the Proof of Real registry's tamper-evident
 * hash chain on Flare.
 *
 * The off-chain registry hash-chains every registration (each record's
 * recordHash commits to the previous one). Anchoring the chain head on Flare
 * makes the ENTIRE history up to that point publicly tamper-provable: the
 * registry operator cannot rewrite or reorder any past record without the
 * new chain head failing to match the anchored one.
 */
contract ProofOfRealAnchor {
    struct Anchor {
        bytes32 chainHead; // recordHash (SHA-256) of the latest registration
        uint64 recordCount; // registrations covered by this anchor
        uint64 anchoredAt; // block timestamp
    }

    /// The registry's signing identity; the only address allowed to anchor.
    address public immutable registrar;

    Anchor[] private _anchors;
    // index + 1 into _anchors, so 0 means "never anchored"
    mapping(bytes32 => uint256) private _indexByHead;

    event Anchored(bytes32 indexed chainHead, uint64 recordCount, uint256 index);

    error NotRegistrar();
    error AlreadyAnchored();
    error ShrinkingChain();
    error NoAnchors();

    constructor(address registrar_) {
        registrar = registrar_;
    }

    /// Record the current head of the registry hash chain.
    function anchor(bytes32 chainHead, uint64 recordCount) external {
        if (msg.sender != registrar) revert NotRegistrar();
        if (_indexByHead[chainHead] != 0) revert AlreadyAnchored();
        if (_anchors.length > 0 && recordCount <= _anchors[_anchors.length - 1].recordCount) {
            revert ShrinkingChain();
        }
        _anchors.push(Anchor(chainHead, recordCount, uint64(block.timestamp)));
        _indexByHead[chainHead] = _anchors.length;
        emit Anchored(chainHead, recordCount, _anchors.length - 1);
    }

    function anchorCount() external view returns (uint256) {
        return _anchors.length;
    }

    function latestAnchor() external view returns (Anchor memory) {
        if (_anchors.length == 0) revert NoAnchors();
        return _anchors[_anchors.length - 1];
    }

    function anchorAt(uint256 index) external view returns (Anchor memory) {
        return _anchors[index];
    }

    /// Check whether a given chain head was ever anchored, and when.
    function isAnchored(bytes32 chainHead)
        external
        view
        returns (bool anchored, uint64 anchoredAt, uint64 recordCount)
    {
        uint256 idx = _indexByHead[chainHead];
        if (idx == 0) return (false, 0, 0);
        Anchor storage a = _anchors[idx - 1];
        return (true, a.anchoredAt, a.recordCount);
    }
}
