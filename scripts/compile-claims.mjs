// Compile the Adjuster contract suite (ClaimPayout + adapted vTPM attestation
// contracts) → contracts/artifacts/*.json.
// Usage: node scripts/compile-claims.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENTRYPOINTS = [
  "contracts/ClaimPayout.sol",
  "contracts/vtpm/FlareVtpmAttestation.sol",
  "contracts/vtpm/OidcSignatureVerification.sol",
];

/** Resolve an import path: project-relative first, then node_modules. */
function findImports(path) {
  for (const base of [join(root, path), join(root, "node_modules", path)]) {
    if (existsSync(base)) return { contents: readFileSync(base, "utf8") };
  }
  return { error: `File not found: ${path}` };
}

const sources = {};
for (const entry of ENTRYPOINTS) {
  sources[entry] = { content: readFileSync(join(root, entry), "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // Flare's C-chain does not support post-London opcodes like PUSH0 on all
    // networks — target london for maximum compatibility.
    evmVersion: "london",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length > 0) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
for (const w of (output.errors ?? []).filter((e) => e.severity === "warning")) {
  console.warn(w.formattedMessage);
}

const WANTED = ["ClaimPayout", "FlareVtpmAttestation", "OidcSignatureVerification"];
const outDir = join(root, "contracts", "artifacts");
mkdirSync(outDir, { recursive: true });

for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, contract] of Object.entries(contracts)) {
    if (!WANTED.includes(name)) continue;
    if (!ENTRYPOINTS.includes(file)) continue;
    const artifact = {
      contractName: name,
      abi: contract.abi,
      bytecode: "0x" + contract.evm.bytecode.object,
      compiler: { solc: solc.version(), evmVersion: "london", optimizer: true },
    };
    const outPath = join(outDir, `${name}.json`);
    writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    console.log(`Compiled ${name} → ${outPath} (ABI entries: ${contract.abi.length})`);
  }
}
console.log(`solc ${solc.version()}`);
