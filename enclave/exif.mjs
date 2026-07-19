// EXIF extraction inside the enclave — the photo's metadata is read in TEE
// memory only; callers receive just the fields claims verification needs.
import sharp from "sharp";
import exifReader from "exif-reader";

/** Degrees/minutes/seconds triplet + hemisphere ref -> signed decimal degrees. */
export function dmsToDecimal(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const [deg, min, sec] = dms.map(Number);
  if ([deg, min, sec].some(Number.isNaN)) return null;
  const sign = ref === "S" || ref === "W" ? -1 : 1;
  return sign * (deg + min / 60 + sec / 3600);
}

/**
 * Extract claim-relevant EXIF from an image buffer.
 * Returns { gpsLat, gpsLon, takenAt, camera } — any field null when absent.
 */
export async function extractExif(buf) {
  const empty = { gpsLat: null, gpsLon: null, takenAt: null, camera: null };

  let meta;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    return empty;
  }
  if (!meta.exif) return empty;

  let tags;
  try {
    tags = exifReader(meta.exif);
  } catch {
    return empty;
  }

  // exif-reader v2 groups: image (IFD0), exif (Photo), gps (GPSInfo).
  const gps = tags.gps ?? tags.GPSInfo ?? {};
  const photo = tags.exif ?? tags.Photo ?? {};
  const image = tags.image ?? tags.Image ?? {};

  const gpsLat = dmsToDecimal(gps.GPSLatitude, gps.GPSLatitudeRef);
  const gpsLon = dmsToDecimal(gps.GPSLongitude, gps.GPSLongitudeRef);

  const rawDate = photo.DateTimeOriginal ?? photo.DateTimeDigitized ?? image.DateTime ?? null;
  const takenAt = rawDate instanceof Date && !Number.isNaN(rawDate.getTime())
    ? rawDate.toISOString()
    : null;

  const camera = [image.Make, image.Model].filter(Boolean).join(" ").trim() || null;

  return { gpsLat, gpsLon, takenAt, camera };
}
