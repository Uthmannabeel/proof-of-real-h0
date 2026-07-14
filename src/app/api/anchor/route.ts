import { ok, fail } from "@/lib/api";
import { anchorConfigured, anchorLedger, getAnchorStatus } from "@/lib/anchor";

export const runtime = "nodejs";

/** Current on-chain anchoring status (ledger head vs. Flare contract). */
export async function GET(): Promise<Response> {
  try {
    return ok(await getAnchorStatus());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Anchor status failed.";
    return fail(message, 500);
  }
}

/** Anchor the current ledger head on Flare Coston2. */
export async function POST(): Promise<Response> {
  if (!anchorConfigured()) {
    return fail("Flare anchoring is not configured on this deployment.", 503);
  }
  try {
    return ok(await anchorLedger());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Anchoring failed.";
    const status = message.includes("already anchored") ? 409 : 500;
    return fail(message, status);
  }
}
