// Proof of Real — Telegram bot core.
//
// Pure logic only: message parsing, verdict formatting, and update routing
// with every side effect injected via `deps`. No network calls here, so the
// whole flow is unit-testable.

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // must match src/lib/api.ts
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const PHASH_BITS = 64; // must match src/lib/hash.ts

export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Extract the verifiable image from a Telegram message, if any.
 * Returns { fileId, mime, filename } | { error } | null (message is not an image).
 */
export function pickImage(message) {
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    // Telegram sorts photo sizes ascending; the last entry is the original-quality render.
    const best = message.photo[message.photo.length - 1];
    return { fileId: best.file_id, mime: "image/jpeg", filename: "photo.jpg" };
  }

  const doc = message.document;
  if (doc && typeof doc.mime_type === "string" && doc.mime_type.startsWith("image/")) {
    if (!ACCEPTED_TYPES.has(doc.mime_type)) {
      return { error: `Unsupported type "${doc.mime_type}". Send PNG, JPEG, WebP, or GIF.` };
    }
    if (typeof doc.file_size === "number" && doc.file_size > MAX_UPLOAD_BYTES) {
      return { error: "File exceeds the 15 MB limit." };
    }
    return { fileId: doc.file_id, mime: doc.mime_type, filename: doc.file_name ?? "image" };
  }

  return null;
}

const VERDICT_HEADERS = {
  "registered-original": "Verdict: registered original",
  "likely-altered": "Verdict: likely altered",
  unregistered: "Verdict: unregistered",
};

function evidenceLine(result) {
  if (result.status === "registered-original") {
    return "Exact SHA-256 match — every byte identical to the registered file.";
  }
  if (result.status === "likely-altered") {
    const pct = Math.round(result.confidence * 100);
    return (
      `Perceptual match at distance ${result.distance}/${PHASH_BITS} ` +
      `(${pct}% similar) — same image as a registered original, pixels altered.`
    );
  }
  return "No exact or near match in the registry.";
}

function registrationLines(registration) {
  if (!registration) return [];
  const registered = registration.createdAt ? registration.createdAt.slice(0, 10) : "unknown";
  return [
    "",
    `<b>${escapeHtml(registration.title)}</b>`,
    `Registered by ${escapeHtml(registration.registrant)} on ${registered}`,
    `Record ${escapeHtml(registration.id)}`,
  ];
}

function enclaveLine(enclave) {
  if (!enclave) return null;
  if (enclave.attested) {
    const hw = enclave.hwModel ? ` on ${escapeHtml(enclave.hwModel)}` : "";
    return `Confidential compute: verified inside an attested TEE${hw}, proof bound to this file's hash.`;
  }
  return "Confidential compute: dev mode — no TEE attestation for this check.";
}

export function anchorLine(anchor) {
  if (!anchor || !anchor.configured) return null;
  if (anchor.rpcError) return "Flare anchor: status unavailable (RPC unreachable).";
  if (anchor.headAnchored && anchor.explorerUrl) {
    return (
      `Flare anchor: ledger head anchored on Coston2 — ` +
      `<a href="${escapeHtml(anchor.explorerUrl)}">view contract</a>`
    );
  }
  if (anchor.headAnchored) return "Flare anchor: ledger head anchored on Coston2.";
  return "Flare anchor: latest ledger head not yet anchored.";
}

/** Render a verification result (plus optional anchor status) as a Telegram HTML message. */
export function formatVerdict(result, anchor) {
  const lines = [`<b>${VERDICT_HEADERS[result.status] ?? "Verdict: unknown"}</b>`, evidenceLine(result)];
  lines.push(...registrationLines(result.registration));

  const extras = [enclaveLine(result.enclave), anchorLine(anchor)].filter(Boolean);
  if (extras.length > 0) lines.push("", ...extras);

  return lines.join("\n");
}

export function welcomeText() {
  return [
    "<b>Proof of Real</b> — media authenticity checks, on Flare.",
    "",
    "Send me a photo or image file and I will check it against the",
    "tamper-evident registry: exact match, altered copy, or unknown.",
    "",
    "Commands:",
    "/status — registry and Flare anchor status",
    "/help — this message",
  ].join("\n");
}

export function statusText(anchor) {
  if (!anchor) return "Registry unreachable — try again shortly.";
  const lines = [
    "<b>Registry status</b>",
    `Records in ledger: ${anchor.currentCount}`,
    anchorLine(anchor) ?? "Flare anchor: not configured.",
  ];
  if (anchor.latest) {
    lines.push(`Last anchor covered ${anchor.latest.recordCount} records at ${anchor.latest.anchoredAt}.`);
  }
  return lines.join("\n");
}

/**
 * Route one Telegram update. All effects go through `deps`:
 *   reply(chatId, html), getFileBuffer(fileId),
 *   verifyImage(buf, mime, filename) -> verification result,
 *   fetchAnchorStatus() -> AnchorStatus | null.
 * Returns the HTML that was sent (for tests), or null when the update was ignored.
 */
export async function handleUpdate(update, deps) {
  const message = update.message;
  if (!message || !message.chat) return null;
  const chatId = message.chat.id;

  const text = typeof message.text === "string" ? message.text.trim() : "";
  if (text.startsWith("/start") || text.startsWith("/help")) {
    return deps.reply(chatId, welcomeText());
  }
  if (text.startsWith("/status")) {
    const anchor = await deps.fetchAnchorStatus();
    return deps.reply(chatId, statusText(anchor));
  }

  const image = pickImage(message);
  if (image === null) {
    if (text.length === 0) return null;
    return deps.reply(chatId, "Send a photo or image file to verify it, or /help for details.");
  }
  if (image.error) return deps.reply(chatId, escapeHtml(image.error));

  try {
    const buf = await deps.getFileBuffer(image.fileId);
    const [result, anchor] = await Promise.all([
      deps.verifyImage(buf, image.mime, image.filename),
      deps.fetchAnchorStatus(),
    ]);
    return deps.reply(chatId, formatVerdict(result, anchor));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Verification failed.";
    return deps.reply(chatId, `Could not verify that image: ${escapeHtml(reason)}`);
  }
}
