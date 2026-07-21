import { fail, ok } from "@/lib/api";
import { adjusterConfigured, submitEvidence } from "@/lib/adjuster";

export const runtime = "nodejs";

const HEX_RE = /^0x[0-9a-fA-F]*$/;

/**
 * Relay the enclave's FCC-signed evidence settlement on-chain. The claim
 * PHOTO never reaches this server — the browser sends it to the enclave
 * directly and forwards only the signed settlement fields here.
 */
export async function POST(req: Request): Promise<Response> {
  if (!adjusterConfigured()) return fail("Adjuster is not configured on this deployment.", 503);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("Body must be JSON.");
  }

  const { resultData, actionId, submissionTag, status, signature } = body;
  if (typeof resultData !== "string" || !HEX_RE.test(resultData)) return fail("'resultData' must be hex.");
  if (typeof actionId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(actionId)) return fail("'actionId' must be bytes32 hex.");
  if (typeof submissionTag !== "string" || submissionTag.length > 32) return fail("'submissionTag' invalid.");
  if (status !== 1) return fail("'status' must be 1.");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return fail("'signature' must be a 65-byte hex signature.");

  try {
    const result = await submitEvidence({ resultData, actionId, submissionTag, status, signature });
    return ok(result);
  } catch (error: unknown) {
    // Surface the contract's spoof-gate revert clearly — it is demo-relevant.
    const message = error instanceof Error ? error.message : "Evidence submission failed.";
    const isSpoof = message.includes("NotAttestedTee") || message.includes("0x6a060b3d");
    return fail(isSpoof ? "Rejected on-chain: signer is not an attested TEE (NotAttestedTee)." : message, isSpoof ? 403 : 500);
  }
}
