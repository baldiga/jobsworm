import { NextResponse } from "next/server";
import { isFreemail, emailDomain } from "@jobsworm/core";
import { createActionClient, createAdminClient, supabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Registering a recruiter.
 *
 * ## Why the service role writes it
 *
 * `recruiters` has RLS on and no policies, so the signed-in session cannot
 * insert into it. That is deliberate: the row decides whether an account's
 * listings are labelled as an agency's, and it links to a `companies` row. A
 * browser must not be able to write either field directly.
 *
 * The identity still comes from the session — `auth.getUser()` on the action
 * client — never from the request body. The body carries only what the person
 * typed.
 *
 * ## Matching an employer to their company
 *
 * By email domain, and only when the match is exact and unambiguous. A wrong
 * match would attach somebody's listings to another company's page, so a
 * near-miss stays null and an admin attaches it during review.
 *
 * ## Anyone may register
 *
 * This was behind an allowlist and refused free email addresses. Both are
 * gone: the recruiter area is open, and a founder on Gmail hiring their first
 * engineer is exactly who should be able to post.
 */
export async function POST(request: Request) {
  // Open to anyone signed in. The identity still comes from the session below,
  // never from the body.
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const supabase = await createActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  /*
   * A free email address is no longer refused.
   *
   * It used to be: "use your work email so we can tell which company you post
   * for". That reasoning held while the area was invitation-only and every
   * recruiter was expected to be a company with a domain. With signup open it
   * turns away the people most likely to post a first job — a two-person
   * startup on Gmail, a founder hiring their first engineer — and it never
   * stopped anybody determined, because a domain costs ten dollars.
   *
   * It is still recorded, because it is worth knowing at review time.
   * `isFreemail` stays imported for that.
   */
  const email = user.email ?? "";
  const freemail = isFreemail(email);

  let body: { kind?: string; org_name?: string; website?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  /*
   * Always "employer". The distinction is gone.
   *
   * `kind` used to be a question on the signup form and it set `is_agency` on
   * every job the account posted, which kept agency listings out of organic
   * search. Treating recruiters as one kind removes that: everyone gets the
   * same surfaces. The column and its check constraint stay, because existing
   * rows use them and `agency_id` is still how the reverse-recruiting product
   * will bill — nothing asks the question any more.
   *
   * Read from the body rather than hardcoded at the insert so an existing
   * client sending "agency" is normalised here rather than silently writing a
   * value nothing else expects.
   */
  const kind = "employer" as const;
  const orgName = String(body.org_name ?? "").trim().slice(0, 120);
  const website = body.website ? String(body.website).trim().slice(0, 300) : null;
  if (!orgName) {
    return NextResponse.json({ error: "Tell us the organisation name." }, { status: 422 });
  }

  const admin = createAdminClient();
  const domain = emailDomain(email);

  // Already registered. Not an error — a double submit, or a second tab.
  const { data: existing } = await admin
    .from("recruiters")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) return NextResponse.json({ ok: true, existing: true });

  let companyId: string | null = null;

  if (domain) {
    const { data: company } = await admin
      .from("companies")
      .select("id")
      .eq("domain", domain)
      .maybeSingle();
    companyId = company?.id ?? null;
  }

  const { error } = await admin.from("recruiters").insert({
    user_id: user.id,
    kind,
    company_id: companyId,
    agency_id: null,
    org_name: orgName,
    website,
    contact_email: email,
    status: "pending",
    // Not a refusal, a note for whoever reads the row later. A free address on
    // an account claiming to be a company is worth a second look when a
    // listing from it is being reviewed; it is not worth blocking signup over.
    admin_notes: freemail ? "signed up with a free email address" : null,
  });
  if (error) {
    console.error("[recruit] recruiter insert failed:", error.message);
    return NextResponse.json({ error: "Could not create the account." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, kind, matched_company: Boolean(companyId) });
}
