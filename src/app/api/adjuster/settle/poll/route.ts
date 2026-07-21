import { fail, ok } from "@/lib/api";
import { adjusterConfigured } from "@/lib/adjuster";
import { pollSettlement } from "@/lib/adjuster-fdc";

export const runtime = "nodejs";

/**
 * Poll an in-flight FDC settlement: one bounded check per call (finalization,
 * then DA-layer proof, then the settle transaction). The browser repeats
 * until state === "settled".
 */
export async function POST(req: Request): Promise<Response> {
  if (!adjusterConfigured()) return fail("Adjuster is not configured on this deployment.", 503);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("Body must be JSON.");
  }

  const { policyId, roundId, abiEncodedRequest } = body;
  if (typeof policyId !== "number" || policyId < 0) return fail("'policyId' invalid.");
  if (typeof roundId !== "number" || roundId <= 0) return fail("'roundId' invalid.");
  if (typeof abiEncodedRequest !== "string" || !/^0x[0-9a-fA-F]+$/.test(abiEncodedRequest)) {
    return fail("'abiEncodedRequest' must be hex.");
  }

  try {
    return ok(
      await pollSettlement({
        policyId,
        roundId,
        abiEncodedRequest,
        submitTxUrl: "",
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Settlement poll failed.";
    return fail(message, 500);
  }
}
