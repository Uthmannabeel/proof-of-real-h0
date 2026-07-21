import { fail, ok } from "@/lib/api";
import { adjusterConfigured, claimsAddress, listPolicies } from "@/lib/adjuster";

export const runtime = "nodejs";

/** Adjuster policies, newest first, plus contract config for the UI. */
export async function GET(): Promise<Response> {
  if (!adjusterConfigured()) {
    return ok({ configured: false, contract: null, policies: [] });
  }
  try {
    const policies = await listPolicies();
    return ok({ configured: true, contract: claimsAddress(), policies });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Policy listing failed.";
    return fail(message, 500);
  }
}
