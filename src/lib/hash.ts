import { createHash } from "node:crypto";
import sharp from "sharp";

/** SHA-256 of the exact bytes — exact-original detection. */
export function contentHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * dHash perceptual fingerprint: resize to 9x8 grayscale, compare each pixel to
 * its right neighbour row-wise -> 64 bits -> 16 hex chars. Survives re-encoding,
 * resizing, and light edits, so altered copies stay close in Hamming distance.
 */
export async function perceptualHash(buf: Buffer): Promise<string> {
  const width = 9;
  const height = 8;
  const { data, info } = await sharp(buf)
    .resize(width, height, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const pixel = (row: number, col: number): number => data[(row * width + col) * channels];

  let bits = "";
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width - 1; col++) {
      bits += pixel(row, col) < pixel(row, col + 1) ? "1" : "0";
    }
  }
  return bitsToHex(bits);
}

/** Dimensions of an image, or nulls if not decodable as one. */
export async function imageDimensions(
  buf: Buffer,
): Promise<{ width: number | null; height: number | null }> {
  try {
    const meta = await sharp(buf).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/** Number of differing bits between two equal-length hex fingerprints (0-64). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

function bitsToHex(bits: string): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex.padStart(16, "0");
}
