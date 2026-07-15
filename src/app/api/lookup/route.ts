import { ok, fail } from "@/lib/api";
import { getStore } from "@/lib/store";
import { NEAR_MATCH_MAX_DISTANCE } from "@/lib/registry";

export const runtime = "nodejs";

const SHA256_HEX = /^[0-9a-f]{64}$/i;
const PHASH_HEX = /^[0-9a-f]{16}$/i;

/**
 * Hash-only registry lookup for the confidential verifier enclave. The enclave
 * computes fingerprints INSIDE the TEE and queries by hash, so the image itself
 * never reaches the registry server. Registry records are public data.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sha = url.searchParams.get("sha");
  const phash = url.searchParams.get("phash");

  if (!sha || !SHA256_HEX.test(sha)) return fail("Query param 'sha' must be 64 hex chars.");
  if (!phash || !PHASH_HEX.test(phash)) return fail("Query param 'phash' must be 16 hex chars.");

  try {
    const store = await getStore();
    const exact = await store.findByContentHash(sha.toLowerCase());
    const near = exact
      ? null
      : await store.findNearest(phash.toLowerCase(), NEAR_MATCH_MAX_DISTANCE);
    return ok({ exact, near });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Lookup failed.";
    return fail(message, 500);
  }
}
