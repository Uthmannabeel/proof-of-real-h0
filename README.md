# Proof of Real

**A public, tamper-evident registry for media authenticity.** Creators seal an original photo into the registry; anyone can then upload any image and get an instant verdict — **registered original**, **altered copy of one**, or **unregistered** — with no account and no trust required.

Built for the **H0: Hack the Zero Stack** hackathon (Vercel + AWS Databases). Open Innovation track.

> In an era of synthetic media, "is this real?" needs an answer you can *check*. Proof of Real makes provenance a public lookup instead of a private claim.

---

## How it works

Every registration stores two fingerprints in **DynamoDB**:

| Fingerprint | Algorithm | Catches |
|-------------|-----------|---------|
| **Content hash** | SHA-256 of exact bytes | the identical original file |
| **Perceptual hash** | dHash (64-bit, 9×8 grayscale gradient) | re-encoded, resized, or lightly edited copies |

**Verify** computes both fingerprints for the uploaded image and:

1. looks up the content hash (exact match → *registered original*);
2. else finds the nearest perceptual fingerprint by Hamming distance (≤ 10/64 → *likely altered copy*, with a confidence score);
3. else reports *unregistered*.

This is deliberately a **registry**, not a "magic AI deepfake detector." It proves provenance for media that was registered — an honest, verifiable guarantee — rather than guessing at images it has never seen.

## Architecture

```
Browser ──upload──▶ Next.js API routes (/api/register, /api/verify)
                         │   SHA-256 + dHash (sharp, Node runtime)
                         ▼
                 ProvenanceStore  (Repository interface)
                   ├── LocalStore   → .data/registrations.json   (dev, zero setup)
                   └── DynamoStore  → DynamoDB single table + 3 GSIs (prod)
```

**DynamoDB single-table design** (`scripts/create-table.mjs`):

- `GSI1` (`CONTENT#<sha256>`) — O(1) exact-original lookup
- `GSI2` (`BUCKET#<phash-prefix>`) — perceptual candidates by fingerprint bucket, then Hamming-ranked
- `GSI3` (`ALL`) — recent registrations for the public ledger

The storage backend swaps via the `DATA_BACKEND` env var with **no call-site changes** (Repository pattern), so the app runs identically with or without AWS.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000  (uses the local JSON backend)
```

Generate test fixtures and smoke-test:

```bash
node scripts/generate-test-images.mjs
# register original.png, then verify original / altered / unrelated
```

## Deploy (Vercel + DynamoDB)

1. Create the table (needs AWS credentials in your shell):
   ```bash
   DYNAMODB_TABLE=proof-of-real node scripts/create-table.mjs
   ```
2. Push to GitHub and import the repo into Vercel.
3. Set Vercel environment variables:
   ```
   DATA_BACKEND=dynamodb
   DYNAMODB_TABLE=proof-of-real
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=…          # an IAM user limited to this table
   AWS_SECRET_ACCESS_KEY=…
   ```
4. Deploy. The frontend is served on Vercel; reads/writes hit DynamoDB.

## Tech

Next.js 16 (App Router, React 19) · TypeScript · Tailwind v4 · `sharp` · AWS SDK v3 (DynamoDB) · Vercel.

## Judging-criteria fit

- **Technological implementation** — real single-table DynamoDB design with three purpose-built GSIs; clean Repository abstraction; Node-runtime image hashing.
- **Design** — a deliberate "official document / registry" visual system, not a template.
- **Impact** — media authenticity is the defining trust problem of the synthetic-media era.
- **Originality** — a *public provenance registry* with honest, checkable guarantees rather than an opaque detector.

## Limitations & roadmap

- Perceptual matching is tuned for images; video/audio fingerprinting is the next track.
- Near-match uses a fingerprint bucket + bounded scan fallback; production scale would add LSH banding across multiple buckets.
- Registration today asserts "this account registered these bytes"; signed capture (C2PA) and authenticated registrants are the natural hardening step.

## License

MIT
