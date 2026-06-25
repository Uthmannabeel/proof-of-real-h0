// Core domain types for the Proof of Real authenticity registry.

export type MediaType = "image" | "video" | "audio";

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
  /** First 12 bits of the phash, used as a DynamoDB bucket key for candidate lookup. */
  phashBucket: string;
  width: number | null;
  height: number | null;
  bytes: number;
  createdAt: string; // ISO timestamp
  provenance: ProvenanceEntry[];
}
