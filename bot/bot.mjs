// Proof of Real — Telegram bot entry point ("send a photo, get a verdict").
//
// Long-polls the Telegram Bot API and verifies incoming images through the
// same pipeline as the web app. With ENCLAVE_URL set, image bytes are
// forwarded straight to the confidential verifier enclave (the registry only
// ever sees hashes); otherwise they go to the app's /api/verify route.
//
// Env: TELEGRAM_BOT_TOKEN (required)
//      APP_URL     — registry app base (default http://localhost:3000)
//      ENCLAVE_URL — optional confidential verifier base
//
// On this Windows machine run with NODE_OPTIONS=--use-system-ca (TLS interception).
import { handleUpdate } from "./core.mjs";
import { createTelegramClient } from "./telegram.mjs";

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ENCLAVE_URL = process.env.ENCLAVE_URL ? process.env.ENCLAVE_URL.replace(/\/$/, "") : null;
const ERROR_BACKOFF_MS = 5_000;

const telegram = createTelegramClient(process.env.TELEGRAM_BOT_TOKEN);

async function readApiResponse(res, label) {
  const body = await res.json();
  if (!body.success) throw new Error(body.error ?? `${label} failed (${res.status}).`);
  return body.data;
}

async function verifyViaApp(buf, mime, filename) {
  const form = new FormData();
  form.set("file", new Blob([buf], { type: mime }), filename);
  const res = await fetch(`${APP_URL}/api/verify`, { method: "POST", body: form });
  return readApiResponse(res, "Verification");
}

async function verifyViaEnclave(buf, mime) {
  const res = await fetch(`${ENCLAVE_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": mime },
    body: buf,
  });
  return readApiResponse(res, "Enclave verification");
}

async function fetchAnchorStatus() {
  try {
    const res = await fetch(`${APP_URL}/api/anchor`);
    return await readApiResponse(res, "Anchor status");
  } catch {
    return null; // verdicts still go out when the anchor status is unavailable
  }
}

const deps = {
  reply: (chatId, html) => telegram.sendMessage(chatId, html).then(() => html),
  getFileBuffer: (fileId) => telegram.getFileBuffer(fileId),
  verifyImage: (buf, mime, filename) =>
    ENCLAVE_URL ? verifyViaEnclave(buf, mime) : verifyViaApp(buf, mime, filename),
  fetchAnchorStatus,
};

async function processUpdate(update) {
  const chatId = update.message?.chat?.id;
  try {
    if (chatId) await telegram.sendTyping(chatId).catch(() => {});
    await handleUpdate(update, deps);
  } catch (error) {
    console.error(`update ${update.update_id} failed:`, error.message ?? error);
  }
}

async function main() {
  console.log(`proof-of-real bot up — verify via ${ENCLAVE_URL ?? `${APP_URL}/api/verify`}`);
  let offset = undefined;

  for (;;) {
    try {
      const updates = await telegram.getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        await processUpdate(update);
      }
    } catch (error) {
      console.error("poll failed:", error.message ?? error);
      await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
    }
  }
}

main();
