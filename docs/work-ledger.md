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
| Jul 19 | Contract suite: `ClaimPayout.sol` (policies, FCC-format evidence settlement with ecrecover, vTPM-attestation-gated signers with loud dev-signer fallback, FDC Web2Json weather settlement pinned to the policy's canonical Open-Meteo URL, FTSOv2 FLR/USD payout conversion); Flare's `flare-vtpm-attestation` vendored verbatim + adapted (upgradeability removed, verification logic unchanged) for on-chain RS256 verification of Confidential Space tokens. All compile clean, solc 0.8.36 / evm london. | (this commit) |

This ledger is updated with every substantial merge.
