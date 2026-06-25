import { fail, ok, readImageFile } from "@/lib/api";
import { verifyMedia } from "@/lib/registry";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const form = await req.formData();

    const file = await readImageFile(form);
    if ("error" in file) return fail(file.error);

    const verification = await verifyMedia(file.buf);
    return ok(verification);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Verification failed.";
    return fail(message, 500);
  }
}
