// Core domain types for the Proof of Real authenticity registry.

export type MediaType = "image" | "video" | "audio";

/**
 * Provenance of a verification run inside the confidential enclave.
 * `attested` means a Google-signed Confidential Space token was issued,
 * nonce-bound to the verified file's SHA-256.
 */
export interface EnclaveInfo {
  attested: boolean;
  inConfidentialSpace: boolean;
  nonceBound: boolean;
  hwModel: string | null;
  swName: string | null;
  imageDigest: string | null;
  issuedAt: string | null;
  token: string | null;
}

/** A single entry in a registration's tamper-evident provenance trail. */
export interface ProvenanceEntry {
  at: string; // ISO timestamp
  action: "registered" | "verified" | "amended";
  note?: string;
}

/** An immutable registration record stored in the registry. */
export interface Registration {
  id: string;
  title: string;
  registrant: string;
  mediaType: MediaType;
  filename: string;
  /** SHA-256 of the exact bytes — proves an identical original. */
  contentHash: string;
  /** 64-bit perceptual (dHash) fingerprint, 16 hex chars — survives re-encoding/edits. */
  phash: string;
  width: number | null;
  height: number | null;
  bytes: number;
  createdAt: string; // ISO timestamp
  provenance: ProvenanceEntry[];

  // Tamper-evidence: each record is hash-chained to the previous one and
  // cryptographically sealed by the registry key.
  prevHash: string | null; // recordHash of the previous registration
  recordHash: string; // SHA-256 of the canonical record (incl. prevHash)
  seal: string; // base64 Ed25519 signature over the canonical record
  sealAlg: "ed25519" | "none";
}
