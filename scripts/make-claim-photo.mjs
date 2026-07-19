// Generate demo claim photos with EXIF GPS + capture time — used for the
// Adjuster demo flow and for exercising the enclave's claim verification.
//
// Usage: node scripts/make-claim-photo.mjs <out.jpg> [lat] [lon] ["YYYY:MM:DD HH:MM:SS"] [seed]
// Different seeds produce visually distinct images (different perceptual hashes).
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { extractExif } from "../enclave/exif.mjs";

const out = process.argv[2] ?? "claim-photo.jpg";
const lat = Number(process.argv[3] ?? 4.8253);
const lon = Number(process.argv[4] ?? 7.0552);
const when = process.argv[5] ?? "2026:07:10 14:30:00";
const seed = Number(process.argv[6] ?? 1);

function toDms(dec) {
  const abs = Math.abs(dec);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = Math.round(((abs - d) * 60 - m) * 60 * 100);
  return `${d}/1 ${m}/1 ${s}/100`;
}

// Structured per-seed scene (gradient + blocks) — unlike noise, structure
// survives JPEG re-encoding, so perceptual near-matching works like it does
// on real photographs.
const rng = (n) => ((seed * 9301 + n * 49297) % 233280) / 233280;
const blocks = Array.from({ length: 6 }, (_, i) => {
  const x = Math.floor(rng(i * 4) * 240);
  const y = Math.floor(rng(i * 4 + 1) * 180);
  const w = 30 + Math.floor(rng(i * 4 + 2) * 60);
  const h = 25 + Math.floor(rng(i * 4 + 3) * 50);
  const shade = Math.floor(40 + rng(i * 7) * 180);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgb(${shade},${Math.floor(shade * 0.8)},${Math.floor(shade * 0.6)})"/>`;
}).join("");
const svg = `<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="rgb(${Math.floor(rng(90) * 120)},${Math.floor(rng(91) * 120 + 60)},${Math.floor(rng(92) * 120 + 100)})"/>
    <stop offset="1" stop-color="rgb(${Math.floor(rng(93) * 80 + 20)},${Math.floor(rng(94) * 80 + 20)},${Math.floor(rng(95) * 80)})"/>
  </linearGradient></defs>
  <rect width="320" height="240" fill="url(#g)"/>${blocks}</svg>`;

const jpeg = await sharp(Buffer.from(svg))
  .jpeg({ quality: 92 })
  .withExif({
    IFD0: { Make: "TestCam", Model: "Adjuster-Demo" },
    IFD2: { DateTimeOriginal: when },
    IFD3: {
      GPSLatitudeRef: lat >= 0 ? "N" : "S",
      GPSLatitude: toDms(lat),
      GPSLongitudeRef: lon >= 0 ? "E" : "W",
      GPSLongitude: toDms(lon),
    },
  })
  .toBuffer();

writeFileSync(out, jpeg);
const readBack = await extractExif(jpeg);
console.log(JSON.stringify({ out, bytes: jpeg.length, readBack }, null, 2));
