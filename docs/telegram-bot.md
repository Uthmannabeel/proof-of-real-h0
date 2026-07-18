# Telegram bot — "send a photo, get a verdict"

The bot puts Proof of Real where people already share media: send it any photo
or image file in Telegram and it replies with the registry verdict — exact
original, likely-altered copy (with perceptual distance), or unregistered —
plus the Flare anchor status and, when routed through the enclave, the
confidential-compute attestation line.

## Setup (5 minutes)

1. In Telegram, message **@BotFather** → `/newbot` → pick a name and username
   (e.g. `ProofOfRealBot`). Copy the token it gives you.
2. Put the token in `.env.local`:

   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-...
   ```

3. Start the registry app (`npm run dev`), then in a second terminal:

   ```
   npm run bot
   ```

   On this Windows machine both processes need `NODE_OPTIONS=--use-system-ca`.

The bot long-polls — no webhook, no public URL, works from a laptop or any
host. Against a deployed registry set `APP_URL=https://your-app.vercel.app`.

## Confidential mode

Set `ENCLAVE_URL` (e.g. `http://localhost:8080`, or the Confidential Space VM)
and the bot forwards image bytes directly to the enclave verifier instead of
the app: the registry only ever receives hashes, and verdicts include the TEE
attestation status. Without it, verification goes through `POST /api/verify`.

## Commands

- send a photo / image file → verdict
- `/status` — ledger size + Flare anchor state
- `/start`, `/help` — usage

## Architecture

```
bot/bot.mjs       entry: long-poll loop, env wiring, verify transport
bot/telegram.mjs  minimal Bot API client (getUpdates, sendMessage, getFile)
bot/core.mjs      pure logic: parsing, routing, HTML verdict formatting
bot/core.test.mjs unit tests (vitest) — run with npm test
```

Limits: Telegram bots can download files up to 20 MB; the registry accepts
15 MB (same as the web app). Compressed Telegram photos arrive as JPEG
re-encodes, so they typically verify as **likely altered** relative to a
registered original — that is the perceptual matcher working as intended, and
it demos well. Send the file "as a document" for byte-exact verification.
