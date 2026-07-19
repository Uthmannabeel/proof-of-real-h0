// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Adapted from flare-foundation/flare-vtpm-attestation @ 13d7985
// (contracts/verifiers/OidcSignatureVerification.sol). Delta vs upstream:
// UUPS upgradeability removed (constructor + minimal Ownable). RSA-signature
// verification logic is UNCHANGED; verbatim original vendored at
// contracts/vendor/flare-vtpm-attestation/.
import {SignatureVerificationFailed} from "../vendor/flare-vtpm-attestation/types/Common.sol";
import {Header, RSAPubKey} from "../vendor/flare-vtpm-attestation/types/OidcStructs.sol";
import {Ownable} from "./Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {RSA} from "@openzeppelin/contracts/utils/cryptography/RSA.sol";

/**
 * @title OidcSignatureVerification
 * @dev Manages and verifies RSA public keys associated with OIDC JWT
 * signatures (Google's Confidential Space attestation tokens). Keys are
 * registered by `kid`; verification is full on-chain RS256.
 */
contract OidcSignatureVerification is Ownable {
    /// @notice Event emitted when a new OIDC RSA public key is added
    event PubKeyAdded(bytes indexed kid, bytes e, bytes n);

    /// @notice Event emitted when an OIDC RSA public key is removed
    event PubKeyRemoved(bytes indexed kid);

    /// @notice Mapping of RSA public keys by Key ID (`kid`)
    mapping(bytes kid => RSAPubKey) internal pubKeys;

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Returns the token type handled by this verifier, which is `"OIDC"`.
     */
    function tokenType() external pure returns (bytes memory) {
        return bytes("OIDC");
    }

    /**
     * @dev Adds an OIDC RSA public key, identified by its Key ID (`kid`).
     */
    function addPubKey(bytes memory kid, bytes memory e, bytes memory n) external onlyOwner {
        pubKeys[kid] = RSAPubKey({e: e, n: n});
        emit PubKeyAdded(kid, e, n);
    }

    /**
     * @dev Removes an OIDC RSA public key from the contract by its Key ID (`kid`).
     */
    function removePubKey(bytes memory kid) external onlyOwner {
        if (pubKeys[kid].n.length == 0) {
            revert("Public key does not exist");
        }
        delete pubKeys[kid];
        emit PubKeyRemoved(kid);
    }

    /**
     * @dev Verifies the RSA signature of a JWT (RS256 over base64url(header).base64url(payload)).
     */
    function verifySignature(
        bytes calldata rawHeader,
        bytes calldata rawPayload,
        bytes calldata rawSignature,
        Header calldata header
    ) public view returns (bool verified, bytes32 digest) {
        string memory headerB64URL = Base64.encodeURL(rawHeader);
        string memory payloadB64URL = Base64.encodeURL(rawPayload);

        bytes memory signingInput = abi.encodePacked(headerB64URL, ".", payloadB64URL);

        digest = sha256(signingInput);

        RSAPubKey storage rsaPublicKey = pubKeys[header.kid];
        if (rsaPublicKey.n.length == 0) {
            revert SignatureVerificationFailed("Public key not found");
        }

        verified = RSA.pkcs1Sha256(digest, rawSignature, rsaPublicKey.e, rsaPublicKey.n);
    }
}
