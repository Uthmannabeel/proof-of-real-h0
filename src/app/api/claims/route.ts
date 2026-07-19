import { fail, ok } from "@/lib/api";
import { registerClaimFingerprint } from "@/lib/registry";

export const runtime = "nodejs";

const SHA256_HEX = /^[0-9a-f]{64}$/i;
const PHASH_HEX = /^[0-9a-f]{16}$/i;

/**
 * Hash-only claim-evidence registration, called by the confidential enclave
 * after it fingerprints a claim photo in TEE memory. The image itself never
 * reaches this server — only its SHA-256 and perceptual hash.
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Body must be JSON.");
  }

  const { policyId, sha, phash } = (body ?? {}) as Record<string, unknown>;
  if (typeof policyId !== "number" || !Number.isInteger(policyId) || policyId < 0) {
    return fail("'policyId' must be a non-negative integer.");
  }
  if (typeof sha !== "string" || !SHA256_HEX.test(sha)) {
    return fail("'sha' must be 64 hex chars.");
  }
  if (typeof phash !== "string" || !PHASH_HEX.test(phash)) {
    return fail("'phash' must be 16 hex chars.");
  }

  try {
    const result = await registerClaimFingerprint({ policyId, sha, phash });
    return ok(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Claim registration failed.";
    return fail(message, 500);
  }
}
