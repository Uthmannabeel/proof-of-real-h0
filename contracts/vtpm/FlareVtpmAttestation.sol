// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Adapted from flare-foundation/flare-vtpm-attestation @ 13d7985
// (contracts/FlareVtpmAttestation.sol). Delta vs upstream: UUPS upgradeability
// removed for a single-deploy hackathon context — Initializable/Ownable-
// Upgradeable replaced with a constructor + minimal Ownable. All JWT parsing,
// payload validation, and registration logic is UNCHANGED from upstream; the
// verbatim original is vendored at contracts/vendor/flare-vtpm-attestation/.
import {IAttestation} from "../vendor/flare-vtpm-attestation/interfaces/IAttestation.sol";
import {IVerification} from "../vendor/flare-vtpm-attestation/interfaces/IVerification.sol";
import {BaseQuoteConfig, Header, QuoteConfig} from "../vendor/flare-vtpm-attestation/types/Common.sol";
import {
    InvalidVerifier,
    PayloadValidationFailed,
    SignatureVerificationFailed
} from "../vendor/flare-vtpm-attestation/types/Common.sol";
import {ParserUtils} from "../vendor/flare-vtpm-attestation/utils/ParserUtils.sol";
import {Ownable} from "./Ownable.sol";

/**
 * @title FlareVtpmAttestation
 * @dev Verifies RSA-signed Confidential Space JWTs and registers vTPM
 * attestations on-chain. A TEE workload calls verifyAndAttest() from its own
 * signing address; the registered quote proves that address belongs to an
 * attested workload with the required image digest.
 */
contract FlareVtpmAttestation is IAttestation, Ownable {
    /// @notice Stores the vTPM configurations for each registered address
    mapping(address => QuoteConfig) public registeredQuotes;

    /// @notice Event emitted when a new vTPM quote configuration is registered
    event QuoteRegistered(address indexed sender, QuoteConfig config);

    /// @notice Event emitted when the base vTPM configuration requirements are updated
    event BaseQuoteConfigUpdated(string indexed imageDigest, string hwmodel, string swname, string iss, bool secboot);

    /// @notice The required base configuration for a vTPM to be considered valid
    BaseQuoteConfig internal requiredConfig;

    /// @notice Mapping of token types to their respective verifier contracts
    mapping(bytes => IVerification) public tokenTypeVerifiers;

    constructor(
        string memory hwmodel,
        string memory swname,
        string memory imageDigest,
        string memory iss,
        bool secboot
    ) Ownable(msg.sender) {
        requiredConfig = BaseQuoteConfig({
            hwmodel: bytes(hwmodel),
            swname: bytes(swname),
            imageDigest: bytes(imageDigest),
            iss: bytes(iss),
            secboot: secboot
        });
    }

    /**
     * @dev Assigns a verifier contract to handle a specific token type.
     */
    function setTokenTypeVerifier(address verifier) external onlyOwner {
        IVerification tokenTypeVerifier = IVerification(verifier);
        bytes memory tokenType = tokenTypeVerifier.tokenType();
        if (tokenType.length == 0) {
            revert InvalidVerifier();
        }
        tokenTypeVerifiers[tokenType] = tokenTypeVerifier;
    }

    /**
     * @dev Retrieves the registered vTPM quote configuration for a specific address.
     */
    function getRegisteredQuote(address quoteAddress) external view returns (QuoteConfig memory) {
        return registeredQuotes[quoteAddress];
    }

    /**
     * @dev Updates the required base configuration parameters for vTPM verification.
     */
    function setBaseQuoteConfig(
        string calldata hwmodel,
        string calldata swname,
        string calldata imageDigest,
        string calldata iss,
        bool secboot
    ) external onlyOwner {
        requiredConfig = BaseQuoteConfig({
            hwmodel: bytes(hwmodel),
            swname: bytes(swname),
            imageDigest: bytes(imageDigest),
            iss: bytes(iss),
            secboot: secboot
        });

        emit BaseQuoteConfigUpdated(imageDigest, hwmodel, swname, iss, secboot);
    }

    /**
     * @dev Verifies a JWT-based attestation and, if valid, registers the token for the caller.
     */
    function verifyAndAttest(bytes calldata header, bytes calldata payload, bytes calldata signature)
        external
        returns (bool success)
    {
        Header memory parsedHeader = parseHeader(header);

        IVerification verifier = tokenTypeVerifiers[parsedHeader.tokenType];
        if (address(verifier) == address(0)) {
            revert InvalidVerifier();
        }

        (bool verified, bytes32 digest) = verifier.verifySignature(header, payload, signature, parsedHeader);
        if (!verified) {
            revert SignatureVerificationFailed("Signature does not match");
        }

        QuoteConfig memory payloadConfig = parsePayload(payload);

        validatePayload(payloadConfig);

        payloadConfig.digest = digest;

        registeredQuotes[msg.sender] = payloadConfig;

        emit QuoteRegistered(msg.sender, payloadConfig);

        return true;
    }

    /**
     * @dev Parses the JWT header to extract metadata such as `tokenType` and `kid`.
     */
    function parseHeader(bytes calldata rawHeader) internal pure returns (Header memory header) {
        header.kid = ParserUtils.extractStringValue(rawHeader, '"kid":"');
        if (ParserUtils.contains(rawHeader, bytes('"x5c":'))) {
            header.tokenType = bytes("PKI");
        } else {
            header.tokenType = bytes("OIDC");
        }
    }

    /**
     * @dev Parses the JWT payload to extract the vTPM configuration values.
     */
    function parsePayload(bytes calldata rawPayload) internal pure returns (QuoteConfig memory config) {
        config.exp = ParserUtils.extractUintValue(rawPayload, '"exp":');
        config.iat = ParserUtils.extractUintValue(rawPayload, '"iat":');
        config.base.iss = ParserUtils.extractStringValue(rawPayload, '"iss":"');
        config.base.secboot = ParserUtils.extractBoolValue(rawPayload, '"secboot":');
        config.base.hwmodel = ParserUtils.extractStringValue(rawPayload, '"hwmodel":"');
        config.base.swname = ParserUtils.extractStringValue(rawPayload, '"swname":"');
        config.base.imageDigest = ParserUtils.extractStringValue(rawPayload, '"image_digest":"');
    }

    /**
     * @dev Validates the parsed vTPM payload configuration against the required configuration.
     */
    function validatePayload(QuoteConfig memory config) internal view {
        if (config.exp < block.timestamp) {
            revert PayloadValidationFailed("Invalid expiry time");
        }
        if (config.iat > block.timestamp) {
            revert PayloadValidationFailed("Invalid issued at time");
        }
        if (keccak256(config.base.iss) != keccak256(requiredConfig.iss)) {
            revert PayloadValidationFailed("Invalid issuer");
        }
        if (config.base.secboot != requiredConfig.secboot) {
            revert PayloadValidationFailed("Invalid 'secboot' value");
        }
        if (keccak256(config.base.hwmodel) != keccak256(requiredConfig.hwmodel)) {
            revert PayloadValidationFailed("Invalid hardware model");
        }
        if (keccak256(config.base.swname) != keccak256(requiredConfig.swname)) {
            revert PayloadValidationFailed("Invalid software name");
        }
        if (keccak256(config.base.imageDigest) != keccak256(requiredConfig.imageDigest)) {
            revert PayloadValidationFailed("Invalid image digest");
        }
    }
}
