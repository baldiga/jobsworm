import { NextResponse } from "next/server";
import { createActionClient, supabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Yes, my CV is still current" — another ninety days.
 *
 * Runs as the signed-in user; `confirm_cv_current()` uses `auth.uid()`, so
 * there is no user id in the request and no way to extend anybody else's
 * window. The body is ignored entirely, which is the point: this endpoint can
 * do exactly one thing.
 */
export async function POST() {
  if (!supabaseConfigured) {
    return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  }

  const supabase = await createActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "sign in first" }, { status: 401 });

  const { data, error } = await supabase.rpc("confirm_cv_current");
  if (error) {
    console.error("[profile/confirm-cv] failed:", error.message);
    return NextResponse.json({ ok: false, error: "could not confirm" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fresh_until: data });
}
