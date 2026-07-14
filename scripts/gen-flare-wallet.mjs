// Generate a fresh Flare deployer wallet and append it to .env.local.
// Prints ONLY the public address; the private key never leaves .env.local.
// Usage: node scripts/gen-flare-wallet.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");

const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
if (/^FLARE_DEPLOYER_PRIVATE_KEY=.+/m.test(existing)) {
  console.error("FLARE_DEPLOYER_PRIVATE_KEY already set in .env.local — refusing to overwrite.");
  const m = existing.match(/^FLARE_DEPLOYER_ADDRESS=(.+)$/m);
  if (m) console.error(`Existing deployer address: ${m[1].trim()}`);
  process.exit(1);
}

const wallet = Wallet.createRandom();
const block = [
  "",
  "# --- Flare (Coston2 testnet) deployer wallet — generated, test funds only ---",
  `FLARE_DEPLOYER_PRIVATE_KEY=${wallet.privateKey}`,
  `FLARE_DEPLOYER_ADDRESS=${wallet.address}`,
  `FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc`,
  "",
].join("\n");

writeFileSync(envPath, existing + block);
console.log("Deployer wallet generated and saved to .env.local");
console.log(`Address: ${wallet.address}`);
console.log("Fund it with free test C2FLR: https://faucet.flare.network/coston2");
