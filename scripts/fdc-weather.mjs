// FDC Web2Json weather settlement for an Adjuster policy:
//   verifier prepareRequest → FdcHub requestAttestation (fee from
//   FdcRequestFeeConfigurations) → wait voting-round finalization (Relay) →
//   DA-layer proof → ClaimPayout.settle(policyId, proof) → FTSO-converted payout.
// The attested URL comes from ClaimPayout.expectedUrl(policyId), so the
// on-chain request pin matches by construction.
// Usage: node scripts/fdc-weather.mjs <policyId>   (NODE_OPTIONS=--use-system-ca)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  hexlify,
  toUtf8Bytes,
  zeroPadBytes,
} from "ethers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function envLocal(name) {
  const content = readFileSync(join(root, ".env.local"), "utf8");
  const m = content.match(new RegExp(`^${name}=(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

const policyId = BigInt(process.argv[2] ?? "0");
const RPC = envLocal("FLARE_RPC_URL") ?? "https://coston2-api.flare.network/ext/C/rpc";
const CLAIMS_ADDR = envLocal("CLAIM_PAYOUT_ADDRESS");
const pk = envLocal("FLARE_DEPLOYER_PRIVATE_KEY");

const VERIFIER_URL = "https://fdc-verifiers-testnet.flare.network/verifier/web2/Web2Json/prepareRequest";
const VERIFIER_API_KEY = "00000000-0000-0000-0000-000000000000"; // public testnet key
const DA_LAYER_URL = "https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round-raw";
const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019"; // same on all Flare networks

// NOTE: the testnet verifier's current jq validator rejects `floor`/`round`
// (Flare's own docs example form now fails); plain multiplication validates,
// and MIC-consistency makes whatever it encodes authoritative.
const POST_PROCESS_JQ = "{precipitationMmE2: (.daily.precipitation_sum[0] * 100)}";
const ABI_SIGNATURE =
  '{"components": [{"internalType": "uint256","name": "precipitationMmE2","type": "uint256"}],"name": "task","type": "tuple"}';

const RESPONSE_TYPE =
  "tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp," +
  " tuple(string url, string httpMethod, string headers, string queryParams, string body," +
  " string postProcessJq, string abiSignature) requestBody, tuple(bytes abiEncodedData) responseBody)";

const provider = new JsonRpcProvider(RPC, 114, { staticNetwork: true });
const wallet = new Wallet(pk, provider);

const registry = new Contract(
  FLARE_CONTRACT_REGISTRY,
  ["function getContractAddressByName(string) view returns (address)"],
  provider,
);
async function flareContract(name, abi, withSigner = false) {
  const address = await registry.getContractAddressByName(name);
  return new Contract(address, abi, withSigner ? wallet : provider);
}

const claimsAbi = JSON.parse(
  readFileSync(join(root, "contracts", "artifacts", "ClaimPayout.json"), "utf8"),
).abi;
const claims = new Contract(CLAIMS_ADDR, claimsAbi, wallet);

const toUtf8Hex32 = (s) => zeroPadBytes(hexlify(toUtf8Bytes(s)), 32);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. Prepare the attestation request at the verifier ---
// URL + queryParams come from the contract itself, so the on-chain pin in
// settle() matches byte-for-byte by construction.
const apiUrl = await claims.WEATHER_API_URL();
const queryParams = await claims.expectedQueryParams(policyId);
console.log(`[1] prepareRequest for policy #${policyId}\n    url: ${apiUrl}\n    queryParams: ${queryParams}`);
const prepared = await fetch(VERIFIER_URL, {
  method: "POST",
  headers: { "X-API-KEY": VERIFIER_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    attestationType: toUtf8Hex32("Web2Json"),
    sourceId: toUtf8Hex32("PublicWeb2"),
    requestBody: {
      url: apiUrl,
      httpMethod: "GET",
      headers: "{}",
      queryParams,
      body: "{}",
      postProcessJq: POST_PROCESS_JQ,
      abiSignature: ABI_SIGNATURE,
    },
  }),
});
if (prepared.status !== 200) throw new Error(`verifier ${prepared.status}: ${await prepared.text()}`);
const { abiEncodedRequest } = await prepared.json();
console.log(`    abiEncodedRequest: ${abiEncodedRequest.slice(0, 42)}… (${(abiEncodedRequest.length - 2) / 2} bytes)`);

// --- 2. Pay the fee and submit to FdcHub ---
const feeConfig = await flareContract(
  "FdcRequestFeeConfigurations",
  ["function getRequestFee(bytes) view returns (uint256)"],
);
const fee = await feeConfig.getRequestFee(abiEncodedRequest);
console.log(`[2] FdcHub.requestAttestation — fee ${formatEther(fee)} C2FLR`);
const fdcHub = await flareContract("FdcHub", ["function requestAttestation(bytes) payable"], true);
const subTx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
const subRcpt = await subTx.wait();

const fsm = await flareContract("FlareSystemsManager", [
  "function firstVotingRoundStartTs() view returns (uint64)",
  "function votingEpochDurationSeconds() view returns (uint64)",
]);
const block = await provider.getBlock(subRcpt.blockNumber);
const roundId = Number(
  (BigInt(block.timestamp) - (await fsm.firstVotingRoundStartTs())) /
    (await fsm.votingEpochDurationSeconds()),
);
console.log(`    submitted in block ${subRcpt.blockNumber}, voting round ${roundId}`);
console.log(`    progress: https://coston2-systems-explorer.flare.rocks/voting-round/${roundId}?tab=fdc`);

// --- 3. Wait for round finalization ---
const fdcVerification = await flareContract("FdcVerification", [
  "function fdcProtocolId() view returns (uint8)",
]);
const relay = await flareContract("Relay", [
  "function isFinalized(uint256,uint256) view returns (bool)",
]);
const protocolId = await fdcVerification.fdcProtocolId();
process.stdout.write("[3] waiting for round finalization");
while (!(await relay.isFinalized(protocolId, roundId))) {
  process.stdout.write(".");
  await sleep(20000);
}
console.log(" finalized");

// --- 4. Fetch the proof from the DA layer (poll a spread of rounds — a
// request can land in a later round, and providers occasionally miss one) ---
console.log("[4] fetching proof from DA layer");
let proof = null;
let proofRound = roundId;
outer: for (let attempt = 0; attempt < 24; attempt++) {
  for (const r of [roundId, roundId + 1, roundId + 2, roundId + 3]) {
    const res = await fetch(DA_LAYER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ votingRoundId: r, requestBytes: abiEncodedRequest }),
    });
    const j = await res.json().catch(() => ({}));
    if (j.response_hex) {
      proof = j;
      proofRound = r;
      break outer;
    }
  }
  process.stdout.write(".");
  await sleep(20000);
}
if (!proof) throw new Error(`no proof in rounds ${roundId}…${roundId + 3} — resubmit (transient provider miss is possible)`);
console.log(`    proof in round ${proofRound}, merkle nodes: ${proof.proof.length}`);

// --- 5. Settle on-chain ---
const decoded = AbiCoder.defaultAbiCoder().decode([RESPONSE_TYPE], proof.response_hex)[0];
const precip = AbiCoder.defaultAbiCoder().decode(
  ["tuple(uint256 precipitationMmE2)"],
  decoded.responseBody.abiEncodedData,
)[0];
console.log(`[5] attested precipitation: ${Number(precip.precipitationMmE2) / 100} mm — settling`);

// ethers' decoded Result is frozen — rebuild as a plain object for the call.
const rb = decoded.requestBody;
const data = {
  attestationType: decoded.attestationType,
  sourceId: decoded.sourceId,
  votingRound: decoded.votingRound,
  lowestUsedTimestamp: decoded.lowestUsedTimestamp,
  requestBody: {
    url: rb.url,
    httpMethod: rb.httpMethod,
    headers: rb.headers,
    queryParams: rb.queryParams,
    body: rb.body,
    postProcessJq: rb.postProcessJq,
    abiSignature: rb.abiSignature,
  },
  responseBody: { abiEncodedData: decoded.responseBody.abiEncodedData },
};

const holder = (await claims.policies(policyId)).holder;
const balBefore = await provider.getBalance(holder);
const settleTx = await claims.settle(policyId, { merkleProof: proof.proof, data });
const settleRcpt = await settleTx.wait();
const settledEvent = settleRcpt.logs
  .map((l) => { try { return claims.interface.parseLog(l); } catch { return null; } })
  .find((e) => e?.name === "Settled");
const balAfter = await provider.getBalance(holder);

console.log(`    Settled: precip ${Number(settledEvent.args.precipitationMmE2) / 100} mm, triggered=${settledEvent.args.triggered}, paid ${formatEther(settledEvent.args.paidWei)} C2FLR, evidenceAttested=${settledEvent.args.evidenceAttested}`);
console.log(`    holder balance delta: +${formatEther(balAfter - balBefore + (holder.toLowerCase() === wallet.address.toLowerCase() ? settleRcpt.fee : 0n))} C2FLR (net of gas when holder=caller)`);
console.log(`    tx: https://coston2-explorer.flare.network/tx/${settleTx.hash}`);
