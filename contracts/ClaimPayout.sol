// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {FtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/FtsoV2Interface.sol";
import {FlareVtpmAttestation} from "./vtpm/FlareVtpmAttestation.sol";
import {QuoteConfig} from "./vendor/flare-vtpm-attestation/types/Common.sol";
import {Ownable} from "./vtpm/Ownable.sol";

/**
 * @title ClaimPayout — Adjuster's parametric claims settlement on Flare
 * @notice Confidential parametric insurance: a claim pays out only when
 *   (1) a TEE-verified evidence settlement, signed in the FCC ActionResult
 *       wire format, confirms the damage photo is authentic, on-site,
 *       in-window, and never used by another claim — the photo itself never
 *       leaves the enclave; and
 *   (2) an FDC Web2Json attestation proves the insured weather event
 *       actually happened at the policy's location and date.
 *   Payouts are denominated in USD cents and converted to native token at
 *   settlement using the FTSOv2 FLR/USD feed.
 *
 * Trust model: the evidence signer must be registered in FlareVtpmAttestation
 * — i.e. it proved ON-CHAIN, via Google's RS256-signed Confidential Space
 * token, that it is a real TEE running the expected image (unlike an
 * owner-set teeAddress, which trusts the owner). An owner-registered dev
 * signer is supported for demos WITHOUT a TEE, but every settlement records
 * loudly whether it was attested or dev-signed.
 */
contract ClaimPayout is Ownable {
    // --- FCC ActionResult wire format (mirrors enclave/fcc.mjs) ---
    uint8 public constant STATUS_SUCCESS = 1;

    // --- FDC constants ---
    bytes32 public constant WEB2JSON_TYPE = bytes32("Web2Json");

    /// @notice FTSOv2 feed id for FLR/USD (category 01 + "FLR/USD").
    bytes21 public constant FLR_USD_FEED = bytes21(0x01464c522f55534400000000000000000000000000);

    struct Policy {
        address holder;
        string date; // coverage date "YYYY-MM-DD" (UTC)
        string lat; // insured location, decimal-degree strings — must match the FDC query exactly
        string lon;
        uint256 rainThresholdMmE2; // payout iff attested precipitation (mm x 100) >= this
        uint256 payoutUsdE2; // payout in USD cents, converted via FTSOv2 at settlement
        uint256 premiumWei; // native token paid at purchase
        bool evidenceApproved;
        bool evidenceAttested; // true = TEE-attested signer; false = dev signer
        bytes32 evidenceHash; // SHA-256 of the verified damage photo (stays enclave-side)
        bool settled;
        bool paidOut;
        uint256 paidWei;
    }

    /// @notice TEE-verified evidence settlement (decoded FCC ActionResult data).
    struct EvidenceResult {
        address contractAddr;
        uint256 policyId;
        bytes32 evidenceHash;
        bool evidenceOk;
        bool reuseDetected;
        int256 exifLatE6;
        int256 exifLonE6;
        uint64 takenAt;
    }

    /// @notice Weather data attested by FDC (decoded Web2Json response body).
    struct WeatherData {
        uint256 precipitationMmE2;
    }

    FlareVtpmAttestation public immutable VTPM;

    /// @notice Owner-registered non-TEE signers, for demos without attestation.
    mapping(address => bool) public devSigners;

    Policy[] public policies;

    event PolicyBought(
        uint256 indexed policyId,
        address indexed holder,
        string date,
        string lat,
        string lon,
        uint256 rainThresholdMmE2,
        uint256 payoutUsdE2,
        uint256 premiumWei
    );
    event EvidenceAccepted(uint256 indexed policyId, bytes32 evidenceHash, bool attested, address signer);
    event Settled(
        uint256 indexed policyId, uint256 precipitationMmE2, bool triggered, uint256 paidWei, bool evidenceAttested
    );
    event DevSignerSet(address indexed signer, bool allowed);
    event PoolFunded(address indexed from, uint256 amountWei);

    error BadStatus();
    error NotAttestedTee(address signer);
    error WrongContract();
    error NoSuchPolicy();
    error AlreadySettled();
    error EvidenceRejected(bool evidenceOk, bool reuseDetected);
    error EvidenceMissing();
    error InvalidFdcProof();
    error WrongAttestationType();
    error RequestMismatch();
    error InsufficientPool();

    constructor(address vtpm) Ownable(msg.sender) {
        VTPM = FlareVtpmAttestation(vtpm);
    }

    // --- Pool ---

    receive() external payable {
        emit PoolFunded(msg.sender, msg.value);
    }

    function withdraw(uint256 amountWei) external onlyOwner {
        (bool sent,) = owner.call{value: amountWei}("");
        require(sent, "withdraw failed");
    }

    // --- Dev signer escape hatch (loudly non-attested) ---

    function setDevSigner(address signer, bool allowed) external onlyOwner {
        devSigners[signer] = allowed;
        emit DevSignerSet(signer, allowed);
    }

    // --- Policy lifecycle ---

    /// @notice Buy a parametric rainfall policy. msg.value is the premium.
    function buyPolicy(
        string calldata date,
        string calldata lat,
        string calldata lon,
        uint256 rainThresholdMmE2,
        uint256 payoutUsdE2
    ) external payable returns (uint256 policyId) {
        require(bytes(date).length == 10, "date must be YYYY-MM-DD");
        require(bytes(lat).length > 0 && bytes(lon).length > 0, "location required");
        require(payoutUsdE2 > 0, "payout required");

        policyId = policies.length;
        policies.push(
            Policy({
                holder: msg.sender,
                date: date,
                lat: lat,
                lon: lon,
                rainThresholdMmE2: rainThresholdMmE2,
                payoutUsdE2: payoutUsdE2,
                premiumWei: msg.value,
                evidenceApproved: false,
                evidenceAttested: false,
                evidenceHash: bytes32(0),
                settled: false,
                paidOut: false,
                paidWei: 0
            })
        );

        emit PolicyBought(policyId, msg.sender, date, lat, lon, rainThresholdMmE2, payoutUsdE2, msg.value);
    }

    /**
     * @notice Submit the TEE's evidence settlement (FCC ActionResult format).
     * @dev Reconstructs ActionResult.Hash() = keccak256(abi.encodePacked(
     *      keccak256(resultData), actionId, keccak256(bytes(submissionTag)), status)),
     *      recovers the EIP-191 signer, and requires it to be either a
     *      vTPM-attested TEE (quote registered on-chain and unexpired) or an
     *      owner-registered dev signer. THIS is the spoof-rejection gate: an
     *      unattested signer, or any tampered field, reverts NotAttestedTee.
     */
    function submitEvidence(
        bytes calldata resultData,
        bytes32 actionId,
        string calldata submissionTag,
        uint8 status,
        bytes calldata signature
    ) external {
        if (status != STATUS_SUCCESS) revert BadStatus();

        bytes32 resultHash =
            keccak256(abi.encodePacked(keccak256(resultData), actionId, keccak256(bytes(submissionTag)), status));
        address signer = _recover(_ethSigned(resultHash), signature);

        bool attested = _isAttested(signer);
        if (!attested && !devSigners[signer]) revert NotAttestedTee(signer);

        EvidenceResult memory ev = abi.decode(resultData, (EvidenceResult));
        if (ev.contractAddr != address(this)) revert WrongContract();
        if (ev.policyId >= policies.length) revert NoSuchPolicy();

        Policy storage p = policies[ev.policyId];
        if (p.settled) revert AlreadySettled();
        if (!ev.evidenceOk || ev.reuseDetected) revert EvidenceRejected(ev.evidenceOk, ev.reuseDetected);

        p.evidenceApproved = true;
        p.evidenceAttested = attested;
        p.evidenceHash = ev.evidenceHash;

        emit EvidenceAccepted(ev.policyId, ev.evidenceHash, attested, signer);
    }

    /**
     * @notice Settle a policy with an FDC Web2Json weather attestation.
     * @dev Requires prior evidence approval. Verifies the Merkle proof via
     *      FdcVerification, pins the attestation type, and requires the
     *      attested request URL to be exactly the policy's canonical
     *      Open-Meteo query — so the weather data provably belongs to this
     *      policy's location and date. Pays out via FTSOv2 FLR/USD.
     */
    function settle(uint256 policyId, IWeb2Json.Proof calldata proof) external {
        if (policyId >= policies.length) revert NoSuchPolicy();
        Policy storage p = policies[policyId];
        if (p.settled) revert AlreadySettled();
        if (!p.evidenceApproved) revert EvidenceMissing();

        if (!ContractRegistry.getFdcVerification().verifyWeb2Json(proof)) revert InvalidFdcProof();
        if (proof.data.attestationType != WEB2JSON_TYPE) revert WrongAttestationType();
        if (keccak256(bytes(proof.data.requestBody.url)) != keccak256(bytes(expectedUrl(policyId)))) {
            revert RequestMismatch();
        }

        WeatherData memory w = abi.decode(proof.data.responseBody.abiEncodedData, (WeatherData));

        p.settled = true;
        bool triggered = w.precipitationMmE2 >= p.rainThresholdMmE2;

        uint256 paidWei = 0;
        if (triggered) {
            paidWei = usdE2ToWei(p.payoutUsdE2);
            if (address(this).balance < paidWei) revert InsufficientPool();
            p.paidOut = true;
            p.paidWei = paidWei;
            (bool sent,) = p.holder.call{value: paidWei}("");
            require(sent, "payout failed");
        }

        emit Settled(policyId, w.precipitationMmE2, triggered, paidWei, p.evidenceAttested);
    }

    // --- Views ---

    function policyCount() external view returns (uint256) {
        return policies.length;
    }

    /// @notice The exact Open-Meteo archive URL this policy's weather proof must attest.
    function expectedUrl(uint256 policyId) public view returns (string memory) {
        Policy storage p = policies[policyId];
        return string.concat(
            "https://archive-api.open-meteo.com/v1/archive?latitude=",
            p.lat,
            "&longitude=",
            p.lon,
            "&start_date=",
            p.date,
            "&end_date=",
            p.date,
            "&daily=precipitation_sum&timezone=UTC"
        );
    }

    /// @notice Convert USD cents to native wei via the FTSOv2 FLR/USD feed.
    function usdE2ToWei(uint256 usdE2) public returns (uint256) {
        FtsoV2Interface ftso = ContractRegistry.getFtsoV2();
        (uint256 priceWei,) = ftso.getFeedByIdInWei(FLR_USD_FEED);
        require(priceWei > 0, "bad price");
        // usdE2 [USD*1e2] * 1e16 -> USD*1e18; * 1e18 / price[USD/FLR*1e18] -> FLR wei
        return (usdE2 * 1e16 * 1e18) / priceWei;
    }

    function _isAttested(address signer) internal view returns (bool) {
        if (address(VTPM) == address(0)) return false;
        QuoteConfig memory q = VTPM.getRegisteredQuote(signer);
        return q.exp >= block.timestamp && q.digest != bytes32(0);
    }

    // --- Signature plumbing (mirrors Flare's FCC example contracts) ---

    function _ethSigned(bytes32 hash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        require(sig.length == 65, "bad signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad signature v");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "invalid signature");
        return signer;
    }
}
