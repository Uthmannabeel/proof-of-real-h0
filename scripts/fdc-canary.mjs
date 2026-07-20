// FDC pipeline canary: run Flare's own documented Web2Json example (swapi)
// through our exact submit/poll flow. Proves whether the pipeline works and
// isolates provider-side source issues (e.g. a blocked weather API host).
// Usage: node scripts/fdc-canary.mjs [url] [jq] [abiSig]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, Wallet, formatEther, hexlify, toUtf8Bytes, zeroPadBytes } from "ethers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envLocal = (name) => {
  const m = readFileSync(join(root, ".env.local"), "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
  return m ? m[1].trim() : null;
};

const url = process.argv[2] ?? "https://swapi.info/api/people/3";
const jq = process.argv[3] ?? '{name: .name, numberOfFilms: .films | length}';
const abiSig = process.argv[4] ??
  '{"components": [{"internalType": "string","name": "name","type": "string"},{"internalType": "uint256","name": "numberOfFilms","type": "uint256"}],"name": "task","type": "tuple"}';
const queryParams = process.argv[5] ?? "{}";

const provider = new JsonRpcProvider("https://coston2-api.flare.network/ext/C/rpc", 114, { staticNetwork: true });
const wallet = new Wallet(envLocal("FLARE_DEPLOYER_PRIVATE_KEY"), provider);
const registry = new Contract(
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
  ["function getContractAddressByName(string) view returns (address)"],
  provider,
);
const toUtf8Hex32 = (s) => zeroPadBytes(hexlify(toUtf8Bytes(s)), 32);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const prep = await fetch("https://fdc-verifiers-testnet.flare.network/verifier/web2/Web2Json/prepareRequest", {
  method: "POST",
  headers: { "X-API-KEY": "00000000-0000-0000-0000-000000000000", "Content-Type": "application/json" },
  body: JSON.stringify({
    attestationType: toUtf8Hex32("Web2Json"),
    sourceId: toUtf8Hex32("PublicWeb2"),
    requestBody: { url, httpMethod: "GET", headers: "{}", queryParams, body: "{}", postProcessJq: jq, abiSignature: abiSig },
  }),
});
const prepJson = await prep.json();
if (!prepJson.abiEncodedRequest) {
  console.error("prepareRequest failed:", JSON.stringify(prepJson));
  process.exit(1);
}
const req = prepJson.abiEncodedRequest;
console.log(`[prepare] OK (${(req.length - 2) / 2} bytes) for ${url}`);

const feeCfg = new Contract(
  await registry.getContractAddressByName("FdcRequestFeeConfigurations"),
  ["function getRequestFee(bytes) view returns (uint256)"],
  provider,
);
const fee = await feeCfg.getRequestFee(req);
const fdcHub = new Contract(
  await registry.getContractAddressByName("FdcHub"),
  ["function requestAttestation(bytes) payable"],
  wallet,
);
const tx = await fdcHub.requestAttestation(req, { value: fee });
const rcpt = await tx.wait();
const fsm = new Contract(
  await registry.getContractAddressByName("FlareSystemsManager"),
  ["function firstVotingRoundStartTs() view returns (uint64)", "function votingEpochDurationSeconds() view returns (uint64)"],
  provider,
);
const block = await provider.getBlock(rcpt.blockNumber);
const round = Number((BigInt(block.timestamp) - (await fsm.firstVotingRoundStartTs())) / (await fsm.votingEpochDurationSeconds()));
console.log(`[submit] block ${rcpt.blockNumber}, fee ${formatEther(fee)}, round ${round}`);

// Poll rounds round..round+3 for up to ~8 minutes.
for (let attempt = 0; attempt < 24; attempt++) {
  for (const r of [round, round + 1, round + 2, round + 3]) {
    const res = await fetch("https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round-raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ votingRoundId: r, requestBytes: req }),
    });
    const j = await res.json().catch(() => ({}));
    if (j.response_hex) {
      console.log(`[proof] FOUND in round ${r} (${j.proof.length} merkle nodes)`);
      console.log(j.response_hex.slice(0, 120) + "…");
      process.exit(0);
    }
  }
  process.stdout.write(".");
  await sleep(20000);
}
console.error("\nNo proof found in rounds", round, "…", round + 3, "— source likely not attestable by providers.");
process.exit(1);
