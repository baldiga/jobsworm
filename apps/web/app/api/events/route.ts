import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

const ALLOWED = new Set(["apply_click", "job_view", "search", "save"]);

/**
 * Anonymous event sink. No identifying data is stored — the row carries the
 * event name, an optional job id and a small props object. Feeds the ghost
 * meter (PLAN.md 5.5), the metrics in section 15, and the public view counter
 * on the job card.
 *
 * That last one is why the anonymity here is load-bearing rather than merely
 * tidy. The view count is shown to everybody, and it is derived from this
 * stream ALONE — never from `job_views`, which is the signed-in reader's own
 * history and is consented personal data. Keeping the two apart is what lets a
 * number be public without any consent covering it changing meaning.
 *
 * So: no `user_id`, no `session_id`, no IP, no fingerprint. A row here says
 * "some visit opened this job" and nothing else, and the de-duplication that
 * stops one reader counting twice happens in their own browser tab, where it
 * costs us no knowledge about them.
 */
export async function POST(request: Request) {
  let body: { name?: string; job_id?: string; props?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const name = body.name;
  if (!name || !ALLOWED.has(name)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    await admin.from("events").insert({
      name,
      job_id: body.job_id ?? null,
      props: (body.props as Record<string, unknown>) ?? {},
    });

    /*
     * The denormalised per-job counters. Both are shown to people — apply
     * clicks feed the ghost meter, views are printed on the card — so both are
     * bumped here, by the service role, and neither RPC is callable by a
     * browser. 0053 had to revoke them from PUBLIC to make that true; the
     * `revoke ... from anon, authenticated` in 0010 had never worked.
     */
    if (body.job_id) {
      if (name === "apply_click") {
        await admin.rpc("bump_apply_click", { p_job_id: body.job_id });
      } else if (name === "job_view") {
        await admin.rpc("bump_job_view", { p_job_id: body.job_id });
      }
    }
  } catch {
    // Analytics must never surface an error to the user.
  }

  return NextResponse.json({ ok: true });
}
