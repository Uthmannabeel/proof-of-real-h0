import { fail, ok } from "@/lib/api";
import { adjusterConfigured, buyPolicy } from "@/lib/adjuster";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COORD_RE = /^-?\d{1,3}(\.\d{1,6})?$/;
const MAX_PAYOUT_USD_E2 = 50; // $0.50 demo cap — the relay wallet funds the pool

/**
 * Buy a demo policy via the relay wallet. Inputs are clamped to demo scale;
 * defaults insure a Port Harcourt address on a recent archived-weather date.
 */
export async function POST(req: Request): Promise<Response> {
  if (!adjusterConfigured()) return fail("Adjuster is not configured on this deployment.", 503);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body = defaults */
  }

  // Default coverage date: 14 days ago (Open-Meteo's archive lags ~5 days).
  const fallbackDate = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const date = typeof body.date === "string" ? body.date : fallbackDate;
  const lat = typeof body.lat === "string" ? body.lat : "4.8156";
  const lon = typeof body.lon === "string" ? body.lon : "7.0498";
  const rainThresholdMmE2 =
    typeof body.rainThresholdMmE2 === "number" ? Math.floor(body.rainThresholdMmE2) : 500;
  const payoutUsdE2 = typeof body.payoutUsdE2 === "number" ? Math.floor(body.payoutUsdE2) : 15;

  if (!DATE_RE.test(date)) return fail("'date' must be YYYY-MM-DD.");
  if (!COORD_RE.test(lat) || !COORD_RE.test(lon)) return fail("'lat'/'lon' must be decimal strings.");
  if (rainThresholdMmE2 < 0 || rainThresholdMmE2 > 100_000) return fail("Threshold out of range.");
  if (payoutUsdE2 < 1 || payoutUsdE2 > MAX_PAYOUT_USD_E2) {
    return fail(`'payoutUsdE2' must be 1..${MAX_PAYOUT_USD_E2} (demo cap).`);
  }

  try {
    const result = await buyPolicy({
      date,
      lat,
      lon,
      rainThresholdMmE2,
      payoutUsdE2,
      premiumC2FLR: "0.1",
    });
    return ok(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Policy purchase failed.";
    return fail(message, 500);
  }
}
