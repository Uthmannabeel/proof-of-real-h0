// Proof of Real — confidential verifier enclave.
//
// Receives an image DIRECTLY from the user's browser, fingerprints it entirely
// in enclave memory, and queries the public registry BY HASH ONLY — the image
// never leaves the TEE and is never written to disk. The verdict returns with
// a Google-signed attestation token whose nonce is the file's SHA-256, proving
// this exact file was verified by this exact code on confidential hardware.
//
// Env: PORT (default 8080), REGISTRY_URL (default http://localhost:3000),
//      ATTESTATION_AUDIENCE (default proof-of-real-verifier)
import { createServer } from "node:http";
import { contentHash, perceptualHash } from "./hash.mjs";
import { fetchAttestationToken, decodeClaims, inConfidentialSpace } from "./attestation.mjs";
import { extractExif } from "./exif.mjs";
import { runClaimChecks } from "./claim.mjs";
import { encodeSettlement, signActionResult, teeWallet } from "./fcc.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TEE_WALLET = teeWallet();

const PORT = Number(process.env.PORT ?? 8080);
const REGISTRY_URL = (process.env.REGISTRY_URL ?? "http://localhost:3000").replace(/\/$/, "");
const AUDIENCE = process.env.ATTESTATION_AUDIENCE ?? "proof-of-real-verifier";
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const NEAR_MATCH_MAX_DISTANCE = 10; // must match src/lib/registry.ts
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...CORS_HEADERS,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error("File exceeds the 15 MB limit."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Same verdict rules as the registry's verifyMedia. */
function classify(exact, near) {
  if (exact) {
    return { status: "registered-original", registration: exact, distance: 0, confidence: 1 };
  }
  if (near) {
    return {
      status: "likely-altered",
      registration: near.record,
      distance: near.distance,
      confidence: Number((1 - near.distance / 64).toFixed(3)),
    };
  }
  return { status: "unregistered", registration: null, distance: null, confidence: 0 };
}

async function handleVerify(req, res) {
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim();
  if (!ACCEPTED_TYPES.has(type)) {
    return json(res, 400, {
      success: false,
      error: `Unsupported type "${type}". Use PNG, JPEG, WebP, or GIF.`,
    });
  }

  let buf;
  try {
    buf = await readBody(req);
  } catch (error) {
    return json(res, 413, { success: false, error: error.message });
  }
  if (buf.length === 0) return json(res, 400, { success: false, error: "Empty upload." });

  // Fingerprint in enclave memory only.
  const sha = contentHash(buf);
  let phash;
  try {
    phash = await perceptualHash(buf);
  } catch {
    return json(res, 400, { success: false, error: "Not a decodable image." });
  }

  // Hash-only registry lookup — the image itself stays in the TEE.
  let lookup;
  try {
    const lookupRes = await fetch(`${REGISTRY_URL}/api/lookup?sha=${sha}&phash=${phash}`);
    lookup = await lookupRes.json();
    if (!lookup.success) throw new Error(lookup.error ?? "Registry lookup failed.");
  } catch (error) {
    return json(res, 502, { success: false, error: `Registry unreachable: ${error.message}` });
  }

  const verdict = classify(lookup.data.exact, lookup.data.near);

  // Attestation bound to this exact file via nonce = SHA-256.
  const token = await fetchAttestationToken(AUDIENCE, sha);
  const claims = token ? decodeClaims(token) : null;
  const enclave = {
    attested: Boolean(token),
    inConfidentialSpace: inConfidentialSpace(),
    nonceBound: Boolean(token),
    hwModel: claims?.hwmodel ?? null,
    swName: claims?.swname ?? null,
    imageDigest: claims?.submods?.container?.image_digest ?? null,
    issuedAt: claims?.iat ? new Date(claims.iat * 1000).toISOString() : null,
    token,
  };

  return json(res, 200, { success: true, data: { ...verdict, enclave } });
}

/**
 * Confidential claim-evidence verification. The claimant's photo is read into
 * enclave memory only: EXIF (GPS + capture time) is extracted, the registry is
 * queried by hash for evidence reuse, and the verdict is signed in the FCC
 * ActionResult format so ClaimPayout.sol can verify it with ecrecover.
 *
 * Query params: policyId (uint), lat, lon (decimal degrees), date (YYYY-MM-DD),
 *               contract (0x… ClaimPayout address), maxKm?, windowDays?
 */
async function handleClaim(req, res, url) {
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim();
  if (!ACCEPTED_TYPES.has(type)) {
    return json(res, 400, {
      success: false,
      error: `Unsupported type "${type}". Use PNG, JPEG, WebP, or GIF.`,
    });
  }

  const q = url.searchParams;
  const policyId = q.get("policyId");
  const lat = Number(q.get("lat"));
  const lon = Number(q.get("lon"));
  const date = q.get("date");
  const contractAddr = q.get("contract") ?? ZERO_ADDRESS;
  if (!/^\d+$/.test(policyId ?? "")) {
    return json(res, 400, { success: false, error: "Query param 'policyId' must be a non-negative integer." });
  }
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return json(res, 400, { success: false, error: "Query params 'lat' and 'lon' must be decimal degrees." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
    return json(res, 400, { success: false, error: "Query param 'date' must be YYYY-MM-DD." });
  }

  let buf;
  try {
    buf = await readBody(req);
  } catch (error) {
    return json(res, 413, { success: false, error: error.message });
  }
  if (buf.length === 0) return json(res, 400, { success: false, error: "Empty upload." });

  // Fingerprint + EXIF in enclave memory only.
  const sha = contentHash(buf);
  let phash;
  try {
    phash = await perceptualHash(buf);
  } catch {
    return json(res, 400, { success: false, error: "Not a decodable image." });
  }
  const exif = await extractExif(buf);

  // Hash-only reuse lookup — catches evidence recycled across claims.
  let lookup;
  try {
    const lookupRes = await fetch(`${REGISTRY_URL}/api/lookup?sha=${sha}&phash=${phash}`);
    lookup = await lookupRes.json();
    if (!lookup.success) throw new Error(lookup.error ?? "Registry lookup failed.");
  } catch (error) {
    return json(res, 502, { success: false, error: `Registry unreachable: ${error.message}` });
  }

  const policy = {
    policyId: Number(policyId),
    lat,
    lon,
    date,
    maxKm: q.get("maxKm") ? Number(q.get("maxKm")) : undefined,
    windowDays: q.get("windowDays") ? Number(q.get("windowDays")) : undefined,
  };
  const verdict = runClaimChecks(exif, policy, lookup.data);

  // Record the evidence fingerprint (hash only — never the image) so future
  // claims reusing this photo are caught. Non-fatal if the registry declines.
  let recorded = false;
  try {
    const rec = await fetch(`${REGISTRY_URL}/api/claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policyId: Number(policyId), sha, phash }),
    });
    recorded = (await rec.json()).success === true;
  } catch {
    recorded = false;
  }

  // Attestation bound to this exact file via nonce = SHA-256.
  const token = await fetchAttestationToken(AUDIENCE, sha);
  const claims = token ? decodeClaims(token) : null;
  const enclave = {
    attested: Boolean(token),
    inConfidentialSpace: inConfidentialSpace(),
    nonceBound: Boolean(token),
    hwModel: claims?.hwmodel ?? null,
    swName: claims?.swname ?? null,
    imageDigest: claims?.submods?.container?.image_digest ?? null,
    issuedAt: claims?.iat ? new Date(claims.iat * 1000).toISOString() : null,
    token,
  };

  // Sign the settlement in the FCC ActionResult wire format.
  const resultData = encodeSettlement({
    contractAddr,
    policyId,
    evidenceSha256: sha,
    evidenceOk: verdict.eligible,
    reuseDetected: verdict.reuseDetected,
    exifLat: exif.gpsLat,
    exifLon: exif.gpsLon,
    takenAt: exif.takenAt,
  });
  const fcc = await signActionResult(TEE_WALLET, resultData);

  return json(res, 200, {
    success: true,
    data: {
      policyId: Number(policyId),
      eligible: verdict.eligible,
      checks: verdict.checks,
      distanceKm: verdict.distanceKm,
      dayGap: verdict.dayGap,
      exif: { ...exif, gpsLat: exif.gpsLat, gpsLon: exif.gpsLon },
      evidenceSha256: sha,
      recorded,
      enclave,
      fcc,
    },
  });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, {
        success: true,
        data: {
          service: "proof-of-real-enclave",
          inConfidentialSpace: inConfidentialSpace(),
          registry: REGISTRY_URL,
          teeAddress: TEE_WALLET.address,
        },
      });
    }
    if (req.method === "POST" && req.url === "/verify") {
      return await handleVerify(req, res);
    }
    if (req.method === "POST" && req.url?.startsWith("/claim")) {
      return await handleClaim(req, res, new URL(req.url, `http://${req.headers.host}`));
    }
    return json(res, 404, { success: false, error: "Not found." });
  } catch (error) {
    return json(res, 500, { success: false, error: error.message ?? "Internal error." });
  }
});

server.listen(PORT, () => {
  console.log(`proof-of-real enclave listening on :${PORT}`);
  console.log(`registry: ${REGISTRY_URL}`);
  console.log(
    inConfidentialSpace()
      ? "Confidential Space detected — attestation ENABLED"
      : "not in Confidential Space — dev mode, attestation unavailable",
  );
});
