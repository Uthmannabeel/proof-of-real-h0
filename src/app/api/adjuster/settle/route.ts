import { fail, ok } from "@/lib/api";
import { adjusterConfigured } from "@/lib/adjuster";
import { startSettlement } from "@/lib/adjuster-fdc";

export const runtime = "nodejs";

/** Start FDC weather settlement: submit the attestation request, return the ticket. */
export async function POST(req: Request): Promise<Response> {
  if (!adjusterConfigured()) return fail("Adjuster is not configured on this deployment.", 503);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("Body must be JSON.");
  }
  const policyId = body.policyId;
  if (typeof policyId !== "number" || !Number.isInteger(policyId) || policyId < 0) {
    return fail("'policyId' must be a non-negative integer.");
  }

  try {
    return ok(await startSettlement(policyId));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Settlement start failed.";
    return fail(message, 500);
  }
}
