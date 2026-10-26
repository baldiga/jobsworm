import { NextResponse } from "next/server";
import { createActionClient } from "@/lib/supabase";

/**
 * Records that the signed-in user looked at a job, and optionally that they
 * applied. Applying is self-reported because the application itself happens on
 * the employer's own site, where we cannot observe it.
 */
export async function POST(request: Request) {
  let body: { job_id?: string; applied?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!body.job_id) return NextResponse.json({ ok: false }, { status: 400 });

  const supabase = await createActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Anonymous browsing is allowed and simply not tracked.
  if (!user) return NextResponse.json({ ok: true, tracked: false });

  const { error } = await supabase.rpc("record_job_view", {
    p_job_id: body.job_id,
    p_applied: typeof body.applied === "boolean" ? body.applied : null,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, tracked: true });
}
