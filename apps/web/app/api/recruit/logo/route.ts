import { NextResponse } from "next/server";
import { createActionClient, createAdminClient, supabaseConfigured } from "@/lib/supabase";
import { getRecruiter } from "@/lib/recruit";
import { publicLogoUrl } from "@/lib/logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 512KB. A logo on a job card is ~64px tall; anything larger is a photograph. */
const MAX_BYTES = 512 * 1024;

/**
 * The company logo, uploaded once on the profile and copied onto each listing.
 *
 * ## Why the bytes are checked, not the content type
 *
 * `file.type` is what the browser claims, taken from the file extension. It is
 * trivially wrong and trivially forged. The bucket is PUBLIC and serves
 * whatever is put in it, so "this says image/png" is not good enough — a file
 * named `logo.png` containing HTML, served from our own origin, is a stored
 * XSS.
 *
 * So the first bytes are read and matched against the actual signatures. PNG
 * begins `89 50 4E 47 0D 0A 1A 0A`; JPEG begins `FF D8 FF`. Nothing else is
 * accepted — not SVG in particular, which is a document that can carry script
 * and is the usual way this goes wrong.
 *
 * ## Why the path is the user id
 *
 * The storage policy in 0051 requires the first path segment to equal
 * `auth.uid()`. Without it, any signed-in user could overwrite anybody's logo,
 * which on a public bucket means putting an arbitrary image on somebody else's
 * paid listing.
 */
export async function POST(request: Request) {
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const supabase = await createActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const recruiter = await getRecruiter();
  if (!recruiter) {
    return NextResponse.json({ error: "Set up a recruiter account first." }, { status: 403 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file." }, { status: 422 });

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is over 512KB. A logo does not need to be." },
      { status: 422 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 422 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) {
    return NextResponse.json(
      {
        error:
          "That is not a PNG or a JPEG. Whatever the file is named, its contents have to be one " +
          "of those two — we will not put anything else on a public page.",
      },
      { status: 422 },
    );
  }

  /*
   * One object per recruiter, overwritten on each upload.
   *
   * `upsert: true` with a fixed name rather than a timestamped one, so
   * changing the logo does not leave the old file readable forever at a URL
   * somebody may still be linking to. The extension follows the SNIFFED type,
   * not the uploaded name.
   */
  const path = `${user.id}/logo.${kind === "png" ? "png" : "jpg"}`;
  const contentType = kind === "png" ? "image/png" : "image/jpeg";

  const { error: uploadError } = await supabase.storage
    .from("company-logos")
    .upload(path, bytes, { upsert: true, contentType });

  if (uploadError) {
    console.error("[recruit] logo upload failed:", uploadError.message);
    return NextResponse.json({ error: "Could not store that file." }, { status: 500 });
  }

  // The recruiters table has RLS on and no policies, so the service role
  // writes it — with the id from the session, never from the request.
  const { error } = await createAdminClient()
    .from("recruiters")
    .update({ logo_path: path })
    .eq("user_id", user.id);
  if (error) {
    console.error("[recruit] logo_path update failed:", error.message);
    return NextResponse.json({ error: "Could not save the logo." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path, url: publicLogoUrl(path) });
}

/**
 * The real type, from the first bytes.
 *
 * Deliberately only two. Every additional format is another parser in every
 * browser that will ever render it, and a logo needs no more than these.
 */
function sniff(b: Uint8Array): "png" | "jpeg" | null {
  if (
    b.length > 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "png";
  }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  return null;
}
