// Adjuster end-to-end on Coston2 (evidence half — FDC weather settle is
// scripts/fdc-weather.mjs): buy a policy, verify a claim photo through the
// confidential enclave, submit the FCC-signed evidence on-chain, then prove
// the spoof-rejection gate live (tampered payload + unregistered signer).
//
// Prereqs: registry (:3001) + enclave (:8090, TEE_SIGNING_KEY set) running;
//          deploy-claims.mjs done. Usage:
//   node scripts/adjuster-e2e.mjs <photo.jpg> [policyDate] [lat] [lon]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, Wallet, parseEther } from "ethers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function envLocal(name) {
  const content = readFileSync(join(root, ".env.local"), "utf8");
  const m = content.match(new RegExp(`^${name}=(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

const photoPath = process.argv[2];
const date = process.argv[3] ?? "2026-07-10";
const lat = process.argv[4] ?? "4.8156";
const lon = process.argv[5] ?? "7.0498";
if (!photoPath) {
  console.error("Usage: node scripts/adjuster-e2e.mjs <photo.jpg> [date] [lat] [lon]");
  process.exit(1);
}

const ENCLAVE = process.env.ENCLAVE_URL ?? "http://localhost:8090";
const RPC = envLocal("FLARE_RPC_URL") ?? "https://coston2-api.flare.network/ext/C/rpc";
const CLAIMS_ADDR = envLocal("CLAIM_PAYOUT_ADDRESS");
const pk = envLocal("FLARE_DEPLOYER_PRIVATE_KEY");
if (!CLAIMS_ADDR || !pk) {
  console.error("CLAIM_PAYOUT_ADDRESS / FLARE_DEPLOYER_PRIVATE_KEY missing — run deploy-claims.mjs.");
  process.exit(1);
}

const abi = JSON.parse(readFileSync(join(root, "contracts", "artifacts", "ClaimPayout.json"), "utf8")).abi;
const provider = new JsonRpcProvider(RPC, 114, { staticNetwork: true });
const wallet = new Wallet(pk, provider);
const claims = new Contract(CLAIMS_ADDR, abi, wallet);

// --- 1. Buy a policy (threshold 5.00 mm rain, 0.1 C2FLR premium) ---
// Payout in USD cents via argv (default $0.15 — FTSO-converted at settlement;
// FLR ≈ $0.006 on Coston2's feed, so keep demo payouts small vs the pool).
const payoutUsdE2 = BigInt(process.argv[6] ?? "15");
console.log(`\n[1] buyPolicy(${date}, ${lat}, ${lon}, threshold 500 mmE2, payout $${(Number(payoutUsdE2) / 100).toFixed(2)})`);
const buyTx = await claims.buyPolicy(date, lat, lon, 500n, payoutUsdE2, { value: parseEther("0.1") });
const buyRcpt = await buyTx.wait();
const policyId = (await claims.policyCount()) - 1n;
console.log(`    policy #${policyId} bought in block ${buyRcpt.blockNumber}`);

// --- 2. Confidential claim verification in the enclave ---
console.log(`\n[2] enclave /claim — photo never leaves the TEE process`);
const photo = readFileSync(photoPath);
const res = await fetch(
  `${ENCLAVE}/claim?policyId=${policyId}&lat=${lat}&lon=${lon}&date=${date}&contract=${CLAIMS_ADDR}`,
  { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: photo },
);
const body = await res.json();
if (!body.success) throw new Error(`enclave: ${body.error}`);
const d = body.data;
for (const c of d.checks) console.log(`    ${c.pass ? "PASS" : "FAIL"} ${c.id}: ${c.finding}`);
console.log(`    eligible=${d.eligible} attested=${d.enclave.attested} signer=${d.fcc.teeAddress}`);
if (!d.eligible) throw new Error("evidence not eligible — aborting");

// --- 3. Submit the FCC-signed evidence on-chain ---
console.log(`\n[3] submitEvidence (FCC ActionResult → ecrecover on-chain)`);
const f = d.fcc;
const evTx = await claims.submitEvidence(f.resultData, f.actionId, f.submissionTag, f.status, f.signature);
const evRcpt = await evTx.wait();
const evEvent = evRcpt.logs
  .map((l) => { try { return claims.interface.parseLog(l); } catch { return null; } })
  .find((e) => e?.name === "EvidenceAccepted");
console.log(`    EvidenceAccepted: policy #${evEvent.args.policyId}, attested=${evEvent.args.attested}, signer=${evEvent.args.signer}`);
console.log(`    tx: https://coston2-explorer.flare.network/tx/${evTx.hash}`);

// --- 4. SPOOF TEST A: tampered result data, original signature ---
console.log(`\n[4] spoof A — tamper one byte of resultData, keep the signature`);
const tampered = f.resultData.slice(0, -2) + (f.resultData.endsWith("00") ? "01" : "00");
try {
  await claims.submitEvidence.staticCall(tampered, f.actionId, f.submissionTag, f.status, f.signature);
  console.log("    !!! ACCEPTED — spoof gate FAILED");
  process.exit(1);
} catch (err) {
  console.log(`    REVERTED as expected: ${err.reason ?? err.shortMessage ?? "NotAttestedTee"}`);
}

// --- 5. SPOOF TEST B: well-formed result signed by an unregistered wallet ---
console.log(`\n[5] spoof B — a fake "TEE" signs a valid-looking settlement`);
const { encodeSettlement, signActionResult } = await import("../enclave/fcc.mjs");
const fake = Wallet.createRandom();
const fakeData = encodeSettlement({
  contractAddr: CLAIMS_ADDR,
  policyId: Number(policyId),
  evidenceSha256: "ff".repeat(32),
  evidenceOk: true,
  reuseDetected: false,
  exifLat: Number(lat),
  exifLon: Number(lon),
  takenAt: `${date}T12:00:00.000Z`,
});
const fakeSigned = await signActionResult(fake, fakeData);
try {
  await claims.submitEvidence.staticCall(
    fakeSigned.resultData, fakeSigned.actionId, fakeSigned.submissionTag, fakeSigned.status, fakeSigned.signature,
  );
  console.log("    !!! ACCEPTED — spoof gate FAILED");
  process.exit(1);
} catch (err) {
  console.log(`    REVERTED as expected: ${err.reason ?? err.shortMessage ?? "NotAttestedTee"}`);
}

console.log(`\nDone. Policy #${policyId} has approved evidence and awaits the FDC weather settlement.`);
console.log(`Next: node scripts/fdc-weather.mjs ${policyId}`);
