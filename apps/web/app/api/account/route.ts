import { NextResponse } from "next/server";
import { createActionClient, createAdminClient } from "@/lib/supabase";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is signed in, for the header.
 *
 * ## Why the header asks over the network instead of reading the session
 *
 * The header lives in the root layout. Reading the session there makes every
 * page dynamic — the home page loses its five-minute ISR cache and every
 * visitor pays a Supabase round trip so the corner of the screen can show a
 * name. That was measured, not guessed: it took the site from nine statically
 * rendered routes to four.
 *
 * So the layout stays static and the chip asks afterwards. A signed-out
 * visitor sees the person icon immediately and nothing changes; a signed-in
 * one sees their name appear a moment later.
 *
 * ## It returns a display name, not an identity
 *
 * The local part of the address and nothing else. The header needs to say "you
 * are signed in, as this account" — it does not need the domain, the user id,
 * or anything that would end up in a screenshot or a support ticket.
 *
 * `isAdmin` rides along so the header can show an Admin link without the
 * layout reading the session itself. It decides what is DRAWN and nothing
 * else: `/admin` calls `requireAdmin()` on the server and 404s regardless of
 * what this said, so a forged answer here buys a link that leads nowhere.
 */
export async function GET() {
  const supabase = await createActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json(
      { signedIn: false },
      // Never cached, and never by a shared cache: this answer is per-person
      // and a CDN holding one visitor's copy would show it to the next.
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const name = user.email.split("@")[0].slice(0, 24);
  return NextResponse.json(
    { signedIn: true, name, isAdmin: isAdminEmail(user.email) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}


/**
 * Deletes the auth user itself, which the delete_my_account RPC cannot reach.
 *
 * Every people table references auth.users with `on delete cascade`, so this
 * alone is sufficient to remove the user's data; the RPC that ran just before
 * it simply makes the deletion explicit and auditable from the user's own
 * session. `releases` is intentionally retained (PLAN.md section 12, 7 years)
 * and holds no direct identifier.
 */
export async function DELETE() {
  const supabase = await createActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }

  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
