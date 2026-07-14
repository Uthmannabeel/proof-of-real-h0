import { describe, expect, test } from "vitest";
import { toBytes32, txExplorerUrl } from "./anchor";

describe("toBytes32", () => {
  test("prefixes a valid sha-256 hex record hash", () => {
    const hash = "ab".repeat(32);
    expect(toBytes32(hash)).toBe(`0x${hash}`);
  });

  test("lowercases mixed-case input", () => {
    const hash = "AB".repeat(32);
    expect(toBytes32(hash)).toBe(`0x${"ab".repeat(32)}`);
  });

  test("rejects hashes that are too short", () => {
    expect(() => toBytes32("abc123")).toThrow(/valid 64-char hex/);
  });

  test("rejects non-hex content", () => {
    expect(() => toBytes32("zz".repeat(32))).toThrow(/valid 64-char hex/);
  });

  test("rejects an already-prefixed hash", () => {
    expect(() => toBytes32(`0x${"ab".repeat(31)}`)).toThrow(/valid 64-char hex/);
  });
});

describe("txExplorerUrl", () => {
  test("builds a Coston2 explorer link", () => {
    expect(txExplorerUrl("0xdeadbeef")).toBe(
      "https://coston2-explorer.flare.network/tx/0xdeadbeef",
    );
  });
});
