import { ok, fail } from "@/lib/api";
import { verifyLedger } from "@/lib/registry";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const audit = await verifyLedger();
    return ok(audit);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Ledger audit failed.";
    return fail(message, 500);
  }
}
