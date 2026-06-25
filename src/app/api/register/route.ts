import { fail, ok, readImageFile, requireText } from "@/lib/api";
import { registerMedia } from "@/lib/registry";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const form = await req.formData();

    const file = await readImageFile(form);
    if ("error" in file) return fail(file.error);

    const title = requireText(form, "title") ?? file.filename;
    const registrant = requireText(form, "registrant") ?? "Anonymous";

    const result = await registerMedia({
      buf: file.buf,
      filename: file.filename,
      mediaType: file.mediaType,
      title,
      registrant,
    });

    return ok(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Registration failed.";
    return fail(message, 500);
  }
}
