// Deploy ProofOfRealAnchor to Flare Coston2 testnet and run a live smoke test.
// Reads FLARE_DEPLOYER_PRIVATE_KEY / FLARE_RPC_URL from .env.local.
// Usage: node scripts/deploy-anchor.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther } from "ethers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function envLocal(name) {
  const content = readFileSync(join(root, ".env.local"), "utf8");
  const m = content.match(new RegExp(`^${name}=(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

const pk = envLocal("FLARE_DEPLOYER_PRIVATE_KEY");
const rpc = envLocal("FLARE_RPC_URL") ?? "https://coston2-api.flare.network/ext/C/rpc";
if (!pk) {
  console.error("FLARE_DEPLOYER_PRIVATE_KEY not set — run: node scripts/gen-flare-wallet.mjs");
  process.exit(1);
}

const provider = new JsonRpcProvider(rpc);
const wallet = new Wallet(pk, provider);
const net = await provider.getNetwork();
const balance = await provider.getBalance(wallet.address);
console.log(`Network: chainId ${net.chainId} via ${rpc}`);
console.log(`Deployer: ${wallet.address} (balance ${formatEther(balance)} C2FLR)`);
if (balance === 0n) {
  console.error("Balance is 0 — fund the address at https://faucet.flare.network/coston2 first.");
  process.exit(1);
}

const artifact = JSON.parse(
  readFileSync(join(root, "contracts", "artifacts", "ProofOfRealAnchor.json"), "utf8"),
);

console.log("Deploying ProofOfRealAnchor (registrar = deployer)...");
const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
const contract = await factory.deploy(wallet.address);
await contract.waitForDeployment();
const address = await contract.getAddress();
console.log(`Deployed at: ${address}`);

// Live smoke test: anchor a synthetic chain head and read it back.
const testHead = "0x" + "ab".repeat(32);
const anchored = new Contract(address, artifact.abi, wallet);
const tx = await anchored.anchor(testHead, 1n);
const receipt = await tx.wait();
const readBack = await anchored.isAnchored(testHead);
console.log(`Smoke test: anchored in block ${receipt.blockNumber}, isAnchored → ${readBack}`);

const deployment = {
  network: "coston2",
  chainId: Number(net.chainId),
  address,
  registrar: wallet.address,
  deployTx: contract.deploymentTransaction()?.hash ?? null,
  smokeTestTx: tx.hash,
  deployedAt: new Date().toISOString(),
  explorer: `https://coston2-explorer.flare.network/address/${address}`,
};
const outPath = join(root, "contracts", "deployment.coston2.json");
writeFileSync(outPath, JSON.stringify(deployment, null, 2));
console.log(`Deployment record → ${outPath}`);
console.log(`Explorer: ${deployment.explorer}`);

// Wire the app up: set FLARE_ANCHOR_ADDRESS in .env.local (add or replace).
const envPath = join(root, ".env.local");
const envContent = readFileSync(envPath, "utf8");
const line = `FLARE_ANCHOR_ADDRESS=${address}`;
const updated = /^FLARE_ANCHOR_ADDRESS=.*$/m.test(envContent)
  ? envContent.replace(/^FLARE_ANCHOR_ADDRESS=.*$/m, line)
  : envContent + `${line}\n`;
writeFileSync(envPath, updated);
console.log("FLARE_ANCHOR_ADDRESS saved to .env.local — the app can anchor now.");
