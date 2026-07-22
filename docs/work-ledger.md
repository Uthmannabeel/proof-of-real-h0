# Work ledger — Flare Summer Signal

Per the hackathon rules, this ledger separates what existed before the program
from what was built during it. Dates are commit dates; everything is verifiable
in this repository's git history.

## Before the hackathon window

| When | What |
|---|---|
| Jun 2026 | Media registry: SHA-256 exact matching, 64-bit perceptual hash with LSH-banded near matching, Ed25519-sealed hash-chain ledger (built for an earlier, unrelated hackathon) |

## During the hackathon window (registered 2026-07-14)

| Date | What | Commit(s) |
|---|---|---|
| Jul 14 | `ProofOfRealAnchor.sol` — Coston2 anchor contract + deploy tooling | f6631a9 |
| Jul 14 | App-side Flare anchoring (`lib/anchor.ts`, `/api/anchor`) | b2569c8 |
| Jul 15 | Contract live on Coston2 (`0x438bF0…768c`), first real anchor tx | b4bdd83 |
| Jul 15 | Evidence-list verdict UI, Flare notarization panel, sample demo flow | c1a3583 |
| Jul 15 | Confidential verifier enclave for Google Confidential Space — image bytes never reach the registry; attestation nonce bound to file SHA-256 | 03773ba |
| Jul 16 | Supabase production registry backend | 7fdbba7 |
| Jul 18 | Telegram bot: send a photo → verdict | 41769f6 |
| Jul 19 | Work ledger started; claims-verification build begins (see subsequent commits) | — |
| Jul 19 | Confidential claim intake: in-enclave EXIF (GPS/time/camera) extraction, location + coverage-window checks, cross-claim perceptual fraud detection with same-policy re-upload exemption, hash-only claim records in the sealed ledger (`/api/claims`), FCC ActionResult settlement signing (EIP-191, ecrecover-compatible). Live-tested: fresh claim, same-policy retry, and a re-encoded copy on another policy caught at distance 1/64. | 9e88c2a |
| Jul 19 | Contract suite: `ClaimPayout.sol` (policies, FCC-format evidence settlement with ecrecover, vTPM-attestation-gated signers with loud dev-signer fallback, FDC Web2Json weather settlement pinned to the policy's canonical Open-Meteo URL, FTSOv2 FLR/USD payout conversion); Flare's `flare-vtpm-attestation` vendored verbatim + adapted (upgradeability removed, verification logic unchanged) for on-chain RS256 verification of Confidential Space tokens. All compile clean, solc 0.8.36 / evm london. | 03d726b |
| Jul 20 | Suite LIVE on Coston2: FlareVtpmAttestation `0xdf7f…E19A`, OIDC verifier `0xE19D…7cb9`, ClaimPayout `0x389b…c015` (pool funded). End-to-end verified on-chain: policy #0 bought → enclave-verified claim evidence accepted via ecrecover (block 33050140±) → spoof A (tampered payload) and spoof B (unregistered signer) both revert `NotAttestedTee`. | b0eb960 |
| Jul 20 | **Full claim lifecycle settled on-chain** (ClaimPayout redeployed `0x8af8…B8b9` — request pin moved to bare URL + canonical queryParams after discovering the live verifier rejects query-in-URL and `floor`/`round` jq, diverging from Flare's docs example). Policy #3: enclave-verified photo evidence → FCC-signed settlement accepted → FDC Web2Json attested 11.7 mm rainfall (round 1401182, 3-node Merkle proof) → threshold met → **$0.15 payout FTSO-converted to 23.29 C2FLR, paid** (tx `0x6883b850…e914`). FDC canary script isolates provider-side flakiness; multi-round proof polling added. | c39c426 |
| Jul 21 | Security fix: the enclave now reads policy terms (location/date) from the ClaimPayout contract it signs over, never from caller-supplied coordinates. Live-verified on policy #6. | 18f43ec |
| Jul 22 | Serverless Adjuster API layer: relay policy purchase, evidence submission (surfaces `NotAttestedTee` as 403), FDC settlement split into start + bounded poll so the browser drives the loop. | e6a939c |
| Jul 22 | **Judge-facing Adjuster UI**: landing rebuilt around Adjuster (real settled claim as the hero "specimen claim file", the $300–900/10–30-days vs <$0.01/~4-min number); `/claim` mobile-first claimant flow with a live-filling evidence-chain docket (photo → enclave → chain → weather → payout); `/desk` insurer dashboard reading policies, evidence attestation state, and pool live from Coston2; registry moved intact to `/registry`. One-click sample claim photos generated per-policy (EXIF GPS + date from the contract), rerolled until perceptually distinct from prior evidence. Fixed a real ABI bug found in live testing: unnamed tuple components in the minimal `settle` ABI broke object-argument mapping in ethers. **Entire lifecycle re-verified through the new routes**: policy #5 — sample photo → enclave verdict → evidence tx `0x138874f8…2c72c` → FDC round 1403092 → 11.7 mm attested → **22.45 C2FLR paid** (tx `0xbb40b3b6…62ce`). | (this commit) |

This ledger is updated with every substantial merge.
