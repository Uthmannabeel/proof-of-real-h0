// Compile contracts/ProofOfRealAnchor.sol → contracts/artifacts/ProofOfRealAnchor.json
// Usage: node scripts/compile-anchor.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "contracts", "ProofOfRealAnchor.sol"), "utf8");

const input = {
  language: "Solidity",
  sources: { "ProofOfRealAnchor.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // Flare's C-chain does not support post-London opcodes like PUSH0 on all
    // networks — target london for maximum compatibility.
    evmVersion: "london",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length > 0) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
for (const w of (output.errors ?? []).filter((e) => e.severity === "warning")) {
  console.warn(w.formattedMessage);
}

const contract = output.contracts["ProofOfRealAnchor.sol"].ProofOfRealAnchor;
const artifact = {
  contractName: "ProofOfRealAnchor",
  abi: contract.abi,
  bytecode: "0x" + contract.evm.bytecode.object,
  compiler: { solc: solc.version(), evmVersion: "london", optimizer: true },
};

const outDir = join(root, "contracts", "artifacts");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "ProofOfRealAnchor.json");
writeFileSync(outPath, JSON.stringify(artifact, null, 2));
console.log(`Compiled OK → ${outPath}`);
console.log(`solc ${solc.version()}, ABI entries: ${contract.abi.length}`);
