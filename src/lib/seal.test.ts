import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  canonicalRecord,
  recordHash,
  registrySealConfigured,
  sealRecord,
  verifySeal,
} from "./seal";

beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const b64 = (pem: string) => Buffer.from(pem, "utf8").toString("base64");
  process.env.REGISTRY_PRIVATE_KEY = b64(
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  process.env.REGISTRY_PUBLIC_KEY = b64(
    publicKey.export({ type: "spki", format: "pem" }).toString(),
  );
});

const record = {
  id: "abc123",
  contentHash: "deadbeef",
  phash: "0cd2d2d2d2c40800",
  title: "Test",
  registrant: "Nabeel",
  mediaType: "image" as const,
  bytes: 1234,
  width: 256,
  height: 256,
  createdAt: "2026-06-28T00:00:00.000Z",
  prevHash: null,
};

describe("registry seal", () => {
  it("is configured under test", () => {
    expect(registrySealConfigured()).toBe(true);
  });

  it("verifies a freshly sealed record", () => {
    const canonical = canonicalRecord(record);
    const { seal } = sealRecord(canonical);
    expect(verifySeal(canonical, seal)).toBe(true);
  });

  it("rejects a tampered record (different title, same seal)", () => {
    const { seal } = sealRecord(canonicalRecord(record));
    const tampered = canonicalRecord({ ...record, title: "Hacked" });
    expect(verifySeal(tampered, seal)).toBe(false);
  });

  it("recordHash changes when any field changes", () => {
    const h1 = recordHash(canonicalRecord(record));
    const h2 = recordHash(canonicalRecord({ ...record, title: "Other" }));
    expect(h1).not.toBe(h2);
  });
});
