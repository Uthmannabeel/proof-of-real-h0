// Fingerprinting inside the enclave — MUST match src/lib/hash.ts exactly so
// enclave verdicts agree with registry records (same sharp ops, same bit order).
import { createHash } from "node:crypto";
import sharp from "sharp";

/** SHA-256 of the exact bytes — exact-original detection. */
export function contentHash(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** dHash: 9x8 grayscale, row-wise right-neighbour comparison -> 64 bits -> 16 hex chars. */
export async function perceptualHash(buf) {
  const width = 9;
  const height = 8;
  const { data, info } = await sharp(buf)
    .resize(width, height, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const pixel = (row, col) => data[(row * width + col) * channels];

  let bits = "";
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width - 1; col++) {
      bits += pixel(row, col) < pixel(row, col + 1) ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex.padStart(16, "0");
}
