// Deploy the Adjuster contract suite to Flare Coston2 and wire it together:
//   1. FlareVtpmAttestation (Confidential Space base config; image digest is a
//      placeholder until the Week-2 reproducible image exists — owner updates
//      it via setBaseQuoteConfig).
//   2. OidcSignatureVerification, registered as the OIDC token-type verifier.
//   3. ClaimPayout(vtpm), pool funded, dev TEE signer registered (loudly
//      non-attested until the real Confidential Space enclave attests).
// Reads FLARE_DEPLOYER_PRIVATE_KEY / FLARE_RPC_URL from .env.local; writes
// TEE_SIGNING_KEY + CLAIM_PAYOUT_ADDRESS back to .env.local.
// Usage: node scripts/deploy-claims.mjs   (NODE_OPTIONS=--use-system-ca on this machine)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther, parseEther } from "ethers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");

const CONFIDENTIAL_SPACE_CONFIG = {
  hwmodel: "GCP_INTEL_TDX",
  swname: "CONFIDENTIAL_SPACE",
  imageDigest: "sha256:pending-reproducible-image", // updated post image build
  iss: "https://confidentialcomputing.googleapis.com",
  secboot: true,
};
const POOL_FUND_C2FLR = "5";

function envLocal(name) {
  const content = readFileSync(envPath, "utf8");
  const m = content.match(new RegExp(`^${name}=(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

function setEnvLocal(name, value) {
  const content = readFileSync(envPath, "utf8");
  const line = `${name}=${value}`;
  const updated = new RegExp(`^${name}=.*$`, "m").test(content)
    ? content.replace(new RegExp(`^${name}=.*$`, "m"), line)
    : content + `${line}\n`;
  writeFileSync(envPath, updated);
}

function artifact(name) {
  return JSON.parse(readFileSync(join(root, "contracts", "artifacts", `${name}.json`), "utf8"));
}

const pk = envLocal("FLARE_DEPLOYER_PRIVATE_KEY");
const rpc = envLocal("FLARE_RPC_URL") ?? "https://coston2-api.flare.network/ext/C/rpc";
if (!pk) {
  console.error("FLARE_DEPLOYER_PRIVATE_KEY not set — run: node scripts/gen-flare-wallet.mjs");
  process.exit(1);
}

const provider = new JsonRpcProvider(rpc, 114, { staticNetwork: true });
const wallet = new Wallet(pk, provider);
const balance = await provider.getBalance(wallet.address);
console.log(`Deployer: ${wallet.address} (balance ${formatEther(balance)} C2FLR)`);
if (balance < parseEther("10")) {
  console.error("Balance under 10 C2FLR — top up at https://faucet.flare.network/coston2 first.");
  process.exit(1);
}

async function deploy(name, ...args) {
  const a = artifact(name);
  const factory = new ContractFactory(a.abi, a.bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${name} deployed at ${address}`);
  return { contract, address, abi: a.abi };
}

// 1. vTPM attestation registry with the Confidential Space base requirements.
const c = CONFIDENTIAL_SPACE_CONFIG;
const vtpm = await deploy(
  "FlareVtpmAttestation",
  c.hwmodel,
  c.swname,
  c.imageDigest,
  c.iss,
  c.secboot,
);

// 2. OIDC RS256 verifier, wired in as the "OIDC" token-type verifier.
const oidc = await deploy("OidcSignatureVerification");
await (await vtpm.contract.setTokenTypeVerifier(oidc.address)).wait();
console.log("OIDC verifier registered on FlareVtpmAttestation");

// 3. ClaimPayout gated by the vTPM registry.
const claims = await deploy("ClaimPayout", vtpm.address);

// Fund the payout pool.
const fundTx = await wallet.sendTransaction({ to: claims.address, value: parseEther(POOL_FUND_C2FLR) });
await fundTx.wait();
console.log(`Pool funded with ${POOL_FUND_C2FLR} C2FLR`);

// Dev TEE signer: stable key for the enclave until real attestation lands.
let teePk = envLocal("TEE_SIGNING_KEY");
if (!teePk) {
  teePk = Wallet.createRandom().privateKey;
  setEnvLocal("TEE_SIGNING_KEY", teePk);
  console.log("Generated TEE_SIGNING_KEY → .env.local (dev signer; replaced by attested key later)");
}
const teeAddress = new Wallet(teePk).address;
await (await claims.contract.setDevSigner(teeAddress, true)).wait();
console.log(`Dev signer registered: ${teeAddress}`);

setEnvLocal("CLAIM_PAYOUT_ADDRESS", claims.address);
setEnvLocal("FLARE_VTPM_ADDRESS", vtpm.address);

const deployment = {
  network: "coston2",
  chainId: 114,
  claimPayout: claims.address,
  flareVtpmAttestation: vtpm.address,
  oidcVerifier: oidc.address,
  deployer: wallet.address,
  devTeeSigner: teeAddress,
  confidentialSpaceConfig: CONFIDENTIAL_SPACE_CONFIG,
  poolFundedC2FLR: POOL_FUND_C2FLR,
  deployedAt: new Date().toISOString(),
  explorer: `https://coston2-explorer.flare.network/address/${claims.address}`,
};
const outPath = join(root, "contracts", "deployment.claims.coston2.json");
writeFileSync(outPath, JSON.stringify(deployment, null, 2));
console.log(`Deployment record → ${outPath}`);
console.log(`Explorer: ${deployment.explorer}`);
