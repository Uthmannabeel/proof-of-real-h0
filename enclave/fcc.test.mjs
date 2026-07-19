import { describe, expect, it } from "vitest";
import {
  AbiCoder,
  Wallet,
  getBytes,
  keccak256,
  solidityPacked,
  toUtf8Bytes,
  verifyMessage,
} from "ethers";
import {
  SUBMISSION_TAG,
  STATUS_SUCCESS,
  actionResultHash,
  encodeSettlement,
  signActionResult,
  teeWallet,
} from "./fcc.mjs";

const SHA = "a".repeat(64);
const SETTLEMENT = {
  contractAddr: "0x438bF0571f687991e8965Eb78ac3eC6A3D26768c",
  policyId: 7,
  evidenceSha256: SHA,
  evidenceOk: true,
  reuseDetected: false,
  exifLat: 4.8156,
  exifLon: 7.0498,
  takenAt: "2026-07-10T14:30:00.000Z",
};

describe("encodeSettlement", () => {
  it("round-trips through ABI decoding with the documented field order", () => {
    const data = encodeSettlement(SETTLEMENT);
    const [addr, policyId, hash, ok, reuse, latE6, lonE6, takenAt] =
      AbiCoder.defaultAbiCoder().decode(
        ["address", "uint256", "bytes32", "bool", "bool", "int256", "int256", "uint64"],
        data,
      );
    expect(addr).toBe(SETTLEMENT.contractAddr);
    expect(policyId).toBe(7n);
    expect(hash).toBe(`0x${SHA}`);
    expect(ok).toBe(true);
    expect(reuse).toBe(false);
    expect(latE6).toBe(4815600n);
    expect(lonE6).toBe(7049800n);
    expect(takenAt).toBe(BigInt(Math.floor(Date.parse(SETTLEMENT.takenAt) / 1000)));
  });

  it("encodes missing EXIF fields as zeros", () => {
    const data = encodeSettlement({ ...SETTLEMENT, exifLat: null, exifLon: null, takenAt: null });
    const [, , , , , latE6, lonE6, takenAt] = AbiCoder.defaultAbiCoder().decode(
      ["address", "uint256", "bytes32", "bool", "bool", "int256", "int256", "uint64"],
      data,
    );
    expect(latE6).toBe(0n);
    expect(lonE6).toBe(0n);
    expect(takenAt).toBe(0n);
  });
});

describe("actionResultHash", () => {
  it("reconstructs the FCC contract's hash exactly", () => {
    const data = encodeSettlement(SETTLEMENT);
    const actionId = `0x${"1".repeat(64)}`;
    // Mirror of Solidity: keccak256(abi.encodePacked(keccak256(data), id, keccak256(bytes(tag)), status))
    const expected = keccak256(
      solidityPacked(
        ["bytes32", "bytes32", "bytes32", "uint8"],
        [keccak256(data), actionId, keccak256(toUtf8Bytes(SUBMISSION_TAG)), STATUS_SUCCESS],
      ),
    );
    expect(actionResultHash(data, actionId, SUBMISSION_TAG, STATUS_SUCCESS)).toBe(expected);
  });
});

describe("signActionResult", () => {
  it("produces an EIP-191 signature that recovers to the TEE address", async () => {
    const wallet = Wallet.createRandom();
    const data = encodeSettlement(SETTLEMENT);

    const result = await signActionResult(wallet, data);

    const hash = actionResultHash(result.resultData, result.actionId, result.submissionTag, result.status);
    expect(verifyMessage(getBytes(hash), result.signature)).toBe(wallet.address);
    expect(result.teeAddress).toBe(wallet.address);
    expect(result.status).toBe(STATUS_SUCCESS);
    expect(result.actionId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changing any signed field breaks recovery to the TEE address", async () => {
    const wallet = Wallet.createRandom();
    const result = await signActionResult(wallet, encodeSettlement(SETTLEMENT));

    const tampered = encodeSettlement({ ...SETTLEMENT, evidenceOk: false });
    const hash = actionResultHash(tampered, result.actionId, result.submissionTag, result.status);
    expect(verifyMessage(getBytes(hash), result.signature)).not.toBe(wallet.address);
  });
});

describe("teeWallet", () => {
  it("uses TEE_SIGNING_KEY when set and is ephemeral otherwise", () => {
    const fixed = Wallet.createRandom();
    process.env.TEE_SIGNING_KEY = fixed.privateKey;
    expect(teeWallet().address).toBe(fixed.address);
    delete process.env.TEE_SIGNING_KEY;
    expect(teeWallet().address).not.toBe(fixed.address);
  });
});
