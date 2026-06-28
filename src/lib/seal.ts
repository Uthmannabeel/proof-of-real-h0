import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
} from "node:crypto";
import type { Registration } from "./types";

/** Fields covered by the seal — everything a tamper would need to change. */
type SealedFields = Pick<
  Registration,
  | "id"
  | "contentHash"
  | "phash"
  | "title"
  | "registrant"
  | "mediaType"
  | "bytes"
  | "width"
  | "height"
  | "createdAt"
  | "prevHash"
>;

export function registrySealConfigured(): boolean {
  return Boolean(process.env.REGISTRY_PRIVATE_KEY);
}

export function publicKeyPem(): string | null {
  return decodePem(process.env.REGISTRY_PUBLIC_KEY);
}

/** Deterministic canonical representation of the sealed fields. */
export function canonicalRecord(r: SealedFields): string {
  return JSON.stringify({
    id: r.id,
    contentHash: r.contentHash,
    phash: r.phash,
    title: r.title,
    registrant: r.registrant,
    mediaType: r.mediaType,
    bytes: r.bytes,
    width: r.width,
    height: r.height,
    createdAt: r.createdAt,
    prevHash: r.prevHash,
  });
}

export function recordHash(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

/** Ed25519-sign the canonical record with the registry private key. */
export function sealRecord(canonical: string): { seal: string; sealAlg: "ed25519" } {
  const pem = decodePem(process.env.REGISTRY_PRIVATE_KEY);
  if (!pem) throw new Error("REGISTRY_PRIVATE_KEY is not configured.");
  const key = createPrivateKey(pem);
  const sig = edSign(null, Buffer.from(canonical, "utf8"), key);
  return { seal: sig.toString("base64"), sealAlg: "ed25519" };
}

/** Verify a record's seal against the registry public key. */
export function verifySeal(canonical: string, sealB64: string): boolean {
  const pem = publicKeyPem();
  if (!pem || !sealB64) return false;
  try {
    const key = createPublicKey(pem);
    return edVerify(null, Buffer.from(canonical, "utf8"), key, Buffer.from(sealB64, "base64"));
  } catch {
    return false;
  }
}

function decodePem(b64: string | undefined): string | null {
  if (!b64) return null;
  return Buffer.from(b64, "base64").toString("utf8");
}
