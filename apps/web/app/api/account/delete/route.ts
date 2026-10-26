import { NextResponse } from "next/server";
import { createActionClient, createAdminClient } from "@/lib/supabase";

/**
 * One-click account deletion (PLAN.md section 8).
 * Removes the profile, CV files, saved jobs, searches, swipes and subscriptions.
 * `consents` and `releases` are retained per the 7-year legal requirement, but
 * they carry no contact details once the auth user is gone.
 */
export async function POST() {
  const supabase = await createActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const admin = createAdminClient();
  const uid = user.id;

  const { data: resumes } = await admin
    .from("resumes")
    .select("storage_path")
    .eq("user_id", uid);

  const paths = (resumes ?? []).map((r: { storage_path: string }) => r.storage_path).filter(Boolean);
  if (paths.length) {
    await admin.storage.from("resumes").remove(paths);
  }

  for (const table of [
    "saved_jobs",
    "saved_searches",
    "swipes",
    "push_subscriptions",
    "feedback",
    "resumes",
    "employment_verifications",
    "profiles",
  ]) {
    await admin.from(table).delete().eq("user_id", uid);
  }

  await supabase.auth.signOut();
  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) return NextResponse.json({ ok: false }, { status: 500 });

  return NextResponse.json({ ok: true });
}
