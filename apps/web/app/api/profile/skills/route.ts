import { NextResponse } from "next/server";
import { createActionClient, supabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Add one skill to your own profile.
 *
 * ## Why this is not just `POST /api/profile`
 *
 * That route takes the whole profile and overwrites it. Calling it from a
 * one-tap "I have this" button would mean the button carrying every other
 * field along with it — and overwriting a change the person made in another
 * tab, or that the CV route made a second ago, with whatever the page happened
 * to be holding.
 *
 * This adds, and only adds. It cannot remove a skill and it cannot touch
 * anything else, which is exactly the authority a one-tap button should have.
 *
 * Runs as the signed-in user against their own row: RLS decides whose profile
 * this is, not the request body.
 */
export async function POST(request: Request) {
  if (!supabaseConfigured) {
    return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  }

  const supabase = await createActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "sign in first" }, { status: 401 });

  let body: { add?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const add = (Array.isArray(body.add) ? body.add : [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.length <= 60)
    .slice(0, 10);
  if (!add.length) return NextResponse.json({ ok: false, error: "nothing to add" }, { status: 400 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("skills")
    .eq("user_id", user.id)
    .maybeSingle();

  const existing = (profile?.skills ?? []) as string[];
  // A union, and capped: a profile with two hundred skills matches everything
  // and therefore matches nothing usefully.
  const merged = [...new Set([...existing, ...add])].slice(0, 80);

  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: user.id, skills: merged }, { onConflict: "user_id" });
  if (error) {
    console.error("[profile/skills] upsert failed:", error.message);
    return NextResponse.json({ ok: false, error: "could not save" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, skills: merged });
}
