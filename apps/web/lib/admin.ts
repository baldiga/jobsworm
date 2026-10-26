import "server-only";
import { notFound } from "next/navigation";
import { createReadClient, supabaseConfigured } from "./supabase";
import { allowlistAdmits } from "./allowlist";

/**
 * Who may reach /admin.
 *
 * ## A 404, not a 403
 *
 * `requireAdmin()` calls `notFound()`. To anyone who is not an admin, the
 * admin area does not exist — no login prompt, no "forbidden", nothing that
 * confirms there is something at this URL worth attacking. A 403 is an
 * invitation to try harder.
 *
 * ## An allowlist of addresses, not a role column
 *
 * There is one administrator. A `roles` table, a claim in the JWT, or a
 * `profiles.is_admin` flag would each be a row somebody could one day write
 * to; an environment variable is a thing only a deploy can change. When there
 * is a second administrator this is still just a longer comma-separated list.
 *
 * Note what this does NOT do: it does not gate the writes. Every admin action
 * goes through a service-role API route that checks this again on the server.
 * This function decides what is rendered; it is not the security boundary on
 * its own.
 */

export function isAdminEmail(email: string | null | undefined): boolean {
  // Shared with the recruiter gate. An unset list admits nobody: a
  // misconfigured deploy must fail closed. See lib/allowlist.ts.
  return allowlistAdmits(process.env.ADMIN_EMAILS, email);
}

/** The signed-in user's email, or null. */
export async function adminEmail(): Promise<string | null> {
  if (!supabaseConfigured) return null;
  const supabase = await createReadClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

/** Renders a 404 for everyone else. Returns the admin's email and user id. */
export async function requireAdmin(): Promise<{ email: string; userId: string }> {
  if (!supabaseConfigured) notFound();
  const supabase = await createReadClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) notFound();
  return { email: user.email!, userId: user.id };
}
