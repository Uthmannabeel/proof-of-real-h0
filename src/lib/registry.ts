import { nanoid } from "nanoid";
import type { MediaType, Registration } from "./types";
import { getStore } from "./store";
import { contentHash, imageDimensions, perceptualHash } from "./hash";

/** Max Hamming distance (of 64) still treated as the same image, just altered. */
export const NEAR_MATCH_MAX_DISTANCE = 10;

export type VerificationStatus =
  | "registered-original"
  | "likely-altered"
  | "unregistered";

export interface Verification {
  status: VerificationStatus;
  registration: Registration | null;
  distance: number | null; // Hamming distance from the matched original
  confidence: number; // 0-1
}

export interface RegisterInput {
  buf: Buffer;
  filename: string;
  title: string;
  registrant: string;
  mediaType: MediaType;
}

export interface RegisterResult {
  registration: Registration;
  alreadyRegistered: boolean;
}

/** Register media, or return the existing record if these exact bytes are already on file. */
export async function registerMedia(input: RegisterInput): Promise<RegisterResult> {
  const store = await getStore();
  const sha = contentHash(input.buf);

  const existing = await store.findByContentHash(sha);
  if (existing) return { registration: existing, alreadyRegistered: true };

  const phash = await perceptualHash(input.buf);
  const { width, height } = await imageDimensions(input.buf);
  const now = new Date().toISOString();

  const registration: Registration = {
    id: nanoid(12),
    title: input.title,
    registrant: input.registrant,
    mediaType: input.mediaType,
    filename: input.filename,
    contentHash: sha,
    phash,
    phashBucket: phash.slice(0, 3),
    width,
    height,
    bytes: input.buf.length,
    createdAt: now,
    provenance: [{ at: now, action: "registered" }],
  };

  await store.put(registration);
  return { registration, alreadyRegistered: false };
}

/** Check an image against the registry: exact original, likely-altered copy, or unknown. */
export async function verifyMedia(buf: Buffer): Promise<Verification> {
  const store = await getStore();

  const exact = await store.findByContentHash(contentHash(buf));
  if (exact) {
    return { status: "registered-original", registration: exact, distance: 0, confidence: 1 };
  }

  const phash = await perceptualHash(buf);
  const near = await store.findNearest(phash, NEAR_MATCH_MAX_DISTANCE);
  if (near) {
    return {
      status: "likely-altered",
      registration: near.record,
      distance: near.distance,
      confidence: Number((1 - near.distance / 64).toFixed(3)),
    };
  }

  return { status: "unregistered", registration: null, distance: null, confidence: 0 };
}

/** Most recent registrations for the public ledger. */
export async function recentRegistrations(limit = 20): Promise<Registration[]> {
  const store = await getStore();
  return store.list(limit);
}
