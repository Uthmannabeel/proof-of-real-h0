// Google Cloud Confidential Space attestation. The container launcher exposes
// a Unix socket; POSTing to /v1/token returns an OIDC JWT signed by Google,
// proving WHAT code is running (image digest) on WHAT hardware (TDX/SEV).
// We bind each token to the verified file via a nonce = its SHA-256.
import { existsSync } from "node:fs";
import http from "node:http";

const TEE_SOCKET = "/run/container_launcher/teeserver.sock";
const TOKEN_PATH = "/v1/token";
const REQUEST_TIMEOUT_MS = 10_000;

/** True only when running inside a real Confidential Space VM. */
export function inConfidentialSpace() {
  return existsSync(TEE_SOCKET);
}

/**
 * Request an attestation token bound to `nonce` (the file's SHA-256).
 * Returns the raw JWT, or null outside Confidential Space / on failure.
 */
export async function fetchAttestationToken(audience, nonce) {
  if (!inConfidentialSpace()) return null;

  const body = JSON.stringify({
    audience,
    token_type: "OIDC",
    ...(nonce ? { nonces: [nonce] } : {}),
  });

  return await new Promise((resolve) => {
    const req = http.request(
      {
        socketPath: TEE_SOCKET,
        path: TOKEN_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(res.statusCode === 200 ? data : null));
      },
    );
    req.on("error", () => resolve(null));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

/** Decode (NOT verify) a JWT's payload for display; relying parties verify signatures themselves. */
export function decodeClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
