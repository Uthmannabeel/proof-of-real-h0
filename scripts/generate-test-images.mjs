// Generates three fixtures for smoke-testing the registry:
//   original.png  — the registered original
//   altered.png   — same image, brightness + slight blur (an "altered copy")
//   unrelated.png — a completely different image (should not match)
// Written to .data/fixtures (tests) AND public/samples (in-app demo buttons).
import sharp from "sharp";
import path from "node:path";
import { mkdir, copyFile } from "node:fs/promises";

const outDir = path.join(process.cwd(), ".data", "fixtures");
await mkdir(outDir, { recursive: true });

const size = 256;

// A structured gradient + shapes so dHash has real signal.
const original = sharp({
  create: { width: size, height: size, channels: 3, background: { r: 30, g: 90, b: 160 } },
})
  .composite([
    {
      input: Buffer.from(
        `<svg width="${size}" height="${size}">
           <rect x="40" y="40" width="120" height="120" fill="#e8d8a0"/>
           <circle cx="190" cy="180" r="50" fill="#b02a1f"/>
           <rect x="0" y="200" width="256" height="56" fill="#1f7a4d"/>
         </svg>`,
      ),
      top: 0,
      left: 0,
    },
  ])
  .png();

await original.clone().toFile(path.join(outDir, "original.png"));

// Altered: brightness up + slight blur — keeps perceptual fingerprint close.
await original
  .clone()
  .modulate({ brightness: 1.12 })
  .blur(1.4)
  .toFile(path.join(outDir, "altered.png"));

// Unrelated: different composition entirely.
await sharp({
  create: { width: size, height: size, channels: 3, background: { r: 200, g: 40, b: 120 } },
})
  .composite([
    {
      input: Buffer.from(
        `<svg width="${size}" height="${size}">
           <rect x="120" y="0" width="40" height="256" fill="#101020"/>
           <circle cx="60" cy="60" r="40" fill="#f0f0d0"/>
         </svg>`,
      ),
      top: 0,
      left: 0,
    },
  ])
  .png()
  .toFile(path.join(outDir, "unrelated.png"));

const samplesDir = path.join(process.cwd(), "public", "samples");
await mkdir(samplesDir, { recursive: true });
for (const name of ["original.png", "altered.png", "unrelated.png"]) {
  await copyFile(path.join(outDir, name), path.join(samplesDir, name));
}

console.log("Fixtures written to", outDir);
console.log("Demo samples written to", samplesDir);
