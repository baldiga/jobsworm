import "server-only";
import { redirect } from "next/navigation";
import { createReadClient, supabaseConfigured } from "./supabase";

/**
 * The recruiter side of the site: who is one, and what they may see.
 *
 * Everything here reads through `recruiter_me()`, a SECURITY DEFINER RPC that
 * filters on `auth.uid()`. The `recruiters` table has RLS on and no policies,
 * so there is no other way to read it from a browser session — which means
 * this module cannot accidentally become the place where authorisation lives.
 * It reads what the database already decided.
 *
 * ## The area is open
 *
 * It used to sit behind `RECRUIT_ALLOWED_EMAILS`, and everything outside that
 * list got a 404 — not a "coming soon", not a sign-in prompt. That was right
 * while the shop was half-built and could take real money: a stranger finding
 * the pricing page and buying a listing that did not work was the worse
 * outcome.
 *
 * The shop is finished, so the list is gone. Anyone may read the pitch, sign
 * up and post. What is left is not an allowlist but a fact about the database:
 * `requireRecruiter` needs a `recruiters` row, and `getRecruiter` returns null
 * without one.
 *
 * Nothing here decides whether a LISTING is acceptable. That is the automatic
 * check at post time, and it is the thing that actually has to hold now that
 * the door is open to everybody.
 */

/**
 * The signed-in user's email, or null.
 *
 * Read from the session rather than taken from anywhere a caller controls.
 */
export async function signedInEmail(): Promise<string | null> {
  if (!supabaseConfigured) return null;
  const supabase = await createReadClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export type Recruiter = {
  user_id: string;
  kind: "employer" | "agency";
  org_name: string;
  website: string | null;
  contact_email: string;
  status: "pending" | "active" | "blocked";
  company_id: string | null;
  agency_id: string | null;
  verified_at: string | null;
  /** Object path in the public company-logos bucket, or null. See 0051. */
  logo_path: string | null;
};

/** The signed-in user's recruiter record, or null if they are not one. */
export async function getRecruiter(): Promise<Recruiter | null> {
  if (!supabaseConfigured) return null;
  const supabase = await createReadClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("recruiter_me");
  if (error) {
    console.error("[recruit] recruiter_me failed:", error.message);
    return null;
  }
  return (data as Recruiter | null) ?? null;
}

/**
 * For pages only a recruiter may see.
 *
 * Signed out → the login page, carrying `next` so they land back here.
 * Signed in but not a recruiter → the signup form, which is the next step
 * rather than an error: somebody who followed a link to the dashboard before
 * registering has not done anything wrong.
 */
export async function requireRecruiter(next: string): Promise<Recruiter> {
  const supabase = supabaseConfigured ? await createReadClient() : null;
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  /*
   * No 404 branch any more.
   *
   * This used to check the allowlist first and render a 404 for anybody not on
   * it — deliberately, so that a stranger could not tell there was anything
   * here. Now that anyone may become a recruiter, the honest answer to "you
   * are not signed in" is the sign-in page, and to "you have no recruiter
   * record" is the form that creates one. Neither is an error.
   */
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(next)}`);

  const recruiter = await getRecruiter();
  if (!recruiter) redirect("/recruit/start");
  return recruiter;
}
