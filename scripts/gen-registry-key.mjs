// Generates an Ed25519 registry keypair for sealing registrations.
// Prints two env lines (base64-encoded PEM) to paste into .env.local / Vercel.
//   node scripts/gen-registry-key.mjs
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

console.log(`REGISTRY_PRIVATE_KEY=${b64(priv)}`);
console.log(`REGISTRY_PUBLIC_KEY=${b64(pub)}`);
