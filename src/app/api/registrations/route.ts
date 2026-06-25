import { ok, fail } from "@/lib/api";
import { recentRegistrations } from "@/lib/registry";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const records = await recentRegistrations(20);
    return ok(records);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load registry.";
    return fail(message, 500);
  }
}
