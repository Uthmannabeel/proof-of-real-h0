import type { MediaType } from "./types";

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function ok<T>(data: T): Response {
  return Response.json({ success: true, data } satisfies ApiResponse<T>);
}

export function fail(error: string, status = 400): Response {
  return Response.json({ success: false, error } satisfies ApiResponse<never>, { status });
}

/** Pull a validated image file out of multipart form data. */
export async function readImageFile(
  form: FormData,
  field = "file",
): Promise<{ buf: Buffer; filename: string; mediaType: MediaType } | { error: string }> {
  const value = form.get(field);
  if (!(value instanceof File)) return { error: "No file uploaded." };
  if (value.size === 0) return { error: "Uploaded file is empty." };
  if (value.size > MAX_UPLOAD_BYTES) return { error: "File exceeds the 15 MB limit." };
  if (!ACCEPTED_IMAGE_TYPES.has(value.type)) {
    return { error: `Unsupported type "${value.type}". Use PNG, JPEG, WebP, or GIF.` };
  }
  const buf = Buffer.from(await value.arrayBuffer());
  return { buf, filename: value.name, mediaType: "image" };
}

export function requireText(form: FormData, field: string, max = 200): string | null {
  const value = form.get(field);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}
