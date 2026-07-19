// Claim-evidence checks — pure logic, no I/O. The enclave runs these against
// EXIF extracted in TEE memory and a hash-only registry lookup, producing the
// evidence verdict that the FCC-format settlement is signed over.

const EARTH_RADIUS_KM = 6371;
export const DEFAULT_MAX_DISTANCE_KM = 5;
export const DEFAULT_WINDOW_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Great-circle distance between two WGS84 points, in km. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Whole days between a photo timestamp and a coverage date ("YYYY-MM-DD"), by UTC day. */
export function daysFromCoverage(takenAtIso, coverageDate) {
  const taken = Date.parse(takenAtIso);
  const coverage = Date.parse(`${coverageDate}T00:00:00Z`);
  if (Number.isNaN(taken) || Number.isNaN(coverage)) return null;
  const takenDay = Math.floor(taken / MS_PER_DAY);
  const coverageDay = Math.floor(coverage / MS_PER_DAY);
  return Math.abs(takenDay - coverageDay);
}

/**
 * Run all claim-evidence checks.
 *
 * @param exif    { gpsLat, gpsLon, takenAt, camera } from extractExif
 * @param policy  { lat, lon, date, maxKm?, windowDays? } — the insured location/date
 * @param lookup  { exact, near } from the hash-only registry lookup; any match on a
 *                prior claim record means this evidence was already used.
 * @returns { eligible, checks: [{ id, pass, finding }] }
 */
export function runClaimChecks(exif, policy, lookup) {
  const maxKm = policy.maxKm ?? DEFAULT_MAX_DISTANCE_KM;
  const windowDays = policy.windowDays ?? DEFAULT_WINDOW_DAYS;
  const checks = [];

  const hasGps = exif.gpsLat !== null && exif.gpsLon !== null;
  let distanceKm = null;
  if (hasGps) {
    distanceKm = haversineKm(exif.gpsLat, exif.gpsLon, policy.lat, policy.lon);
    checks.push({
      id: "location-match",
      pass: distanceKm <= maxKm,
      finding:
        distanceKm <= maxKm
          ? `Photo GPS is ${distanceKm.toFixed(2)} km from the insured location (limit ${maxKm} km).`
          : `Photo GPS is ${distanceKm.toFixed(2)} km from the insured location — outside the ${maxKm} km limit.`,
    });
  } else {
    checks.push({
      id: "location-match",
      pass: false,
      finding: "Photo carries no GPS metadata, so the location cannot be verified.",
    });
  }

  let dayGap = null;
  if (exif.takenAt) {
    dayGap = daysFromCoverage(exif.takenAt, policy.date);
    const pass = dayGap !== null && dayGap <= windowDays;
    checks.push({
      id: "time-match",
      pass,
      finding: pass
        ? `Photo taken ${dayGap} day(s) from the coverage date (window ${windowDays} days).`
        : `Photo timestamp is ${dayGap ?? "unreadable"} day(s) from the coverage date — outside the ${windowDays}-day window.`,
    });
  } else {
    checks.push({
      id: "time-match",
      pass: false,
      finding: "Photo carries no capture timestamp, so the date cannot be verified.",
    });
  }

  const reuseMatch = lookup?.exact ?? lookup?.near?.record ?? null;
  // A claimant re-uploading their own evidence for the SAME policy is a retry,
  // not fraud — reuse only counts when the match belongs to a different claim.
  const samePolicy =
    reuseMatch !== null &&
    policy.policyId !== undefined &&
    reuseMatch.registrant === `adjuster:policy:${policy.policyId}`;
  const reuseDetected = Boolean(reuseMatch) && !samePolicy;
  checks.push({
    id: "no-reuse",
    pass: !reuseDetected,
    finding: reuseDetected
      ? `This image ${lookup.exact ? "exactly matches" : `perceptually matches (distance ${lookup.near.distance}/64)`} evidence already on file: "${reuseMatch.title}".`
      : samePolicy
        ? "Matches this policy's own earlier submission — treated as a re-upload, not reuse."
        : "No exact or near match against previously submitted evidence.",
  });

  const eligible = checks.every((c) => c.pass);
  return { eligible, reuseDetected, distanceKm, dayGap, checks };
}
