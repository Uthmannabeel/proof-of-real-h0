import sharp from "sharp";

/**
 * Generate a demo claim photo with EXIF GPS + capture time baked in, matching
 * a given policy's insured location and coverage date. Mirrors
 * scripts/make-claim-photo.mjs: a structured per-seed scene (gradient +
 * blocks) so the perceptual hash survives JPEG re-encoding the way a real
 * photograph's does — pure noise would not.
 */

function toDms(dec: number): string {
  const abs = Math.abs(dec);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = Math.round(((abs - d) * 60 - m) * 60 * 100);
  return `${d}/1 ${m}/1 ${s}/100`;
}

/** splitmix-style per-seed mixing so nearby seeds produce unrelated scenes. */
function makeRng(seed: number): (n: number) => number {
  return (n: number) => {
    let x = (seed * 0x9e3779b9 + n * 0x85ebca6b) >>> 0;
    x ^= x >>> 16;
    x = (x * 0x45d9f3b) >>> 0;
    x ^= x >>> 16;
    return x / 0xffffffff;
  };
}

export interface ClaimPhotoInput {
  lat: number;
  lon: number;
  /** EXIF DateTimeOriginal, "YYYY:MM:DD HH:MM:SS". */
  when: string;
  seed: number;
}

export async function makeClaimPhoto(input: ClaimPhotoInput): Promise<Buffer> {
  const rng = makeRng(input.seed);
  const nBlocks = 8 + Math.floor(rng(1) * 7);
  const blocks = Array.from({ length: nBlocks }, (_, i) => {
    const x = Math.floor(rng(i * 5 + 10) * 280) - 20;
    const y = Math.floor(rng(i * 5 + 11) * 220) - 20;
    const w = 20 + Math.floor(rng(i * 5 + 12) * 140);
    const h = 15 + Math.floor(rng(i * 5 + 13) * 110);
    const r = Math.floor(rng(i * 5 + 14) * 255);
    const g = Math.floor(rng(i * 7 + 15) * 255);
    const b = Math.floor(rng(i * 11 + 16) * 255);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgb(${r},${g},${b})"/>`;
  }).join("");
  const gx = [0, 1, 0, 1, 0.5][Math.floor(rng(2) * 5)];
  const gy = [0, 0, 1, 1, 0][Math.floor(rng(3) * 5)];
  const svg = `<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="${gx}" y1="${gy}" x2="${1 - gx}" y2="${1 - gy}">
    <stop offset="0" stop-color="rgb(${Math.floor(rng(90) * 255)},${Math.floor(rng(91) * 255)},${Math.floor(rng(92) * 255)})"/>
    <stop offset="1" stop-color="rgb(${Math.floor(rng(93) * 255)},${Math.floor(rng(94) * 255)},${Math.floor(rng(95) * 255)})"/>
  </linearGradient></defs>
  <rect width="320" height="240" fill="url(#g)"/>${blocks}</svg>`;

  return sharp(Buffer.from(svg))
    .jpeg({ quality: 92 })
    .withExif({
      IFD0: { Make: "TestCam", Model: "Adjuster-Demo" },
      IFD2: { DateTimeOriginal: input.when },
      IFD3: {
        GPSLatitudeRef: input.lat >= 0 ? "N" : "S",
        GPSLatitude: toDms(input.lat),
        GPSLongitudeRef: input.lon >= 0 ? "E" : "W",
        GPSLongitude: toDms(input.lon),
      },
    })
    .toBuffer();
}
