// Seed the demo: register the bundled sample original so the in-app
// "Try a sample" buttons produce meaningful verdicts immediately.
// Run against a RUNNING instance:  node scripts/seed-demo.mjs [baseUrl]
// e.g.  node scripts/seed-demo.mjs http://localhost:3000
import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const samplePath = path.join(process.cwd(), "public", "samples", "original.png");

const bytes = await readFile(samplePath);
const form = new FormData();
form.set("file", new File([bytes], "original.png", { type: "image/png" }));
form.set("title", "Harbor Composition No. 1 (demo sample)");
form.set("registrant", "Proof of Real — demo");

const res = await fetch(`${baseUrl}/api/register`, { method: "POST", body: form });
const body = await res.json();
if (!body.success) {
  console.error("Seeding failed:", body.error ?? res.status);
  process.exit(1);
}
const r = body.data.registration;
console.log(
  body.data.alreadyRegistered
    ? `Sample already registered (id ${r.id}) — nothing to do.`
    : `Sample original registered: id ${r.id}, recordHash ${r.recordHash.slice(0, 12)}…`,
);
