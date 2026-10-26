import { NextResponse } from "next/server";
import { createReadClient, supabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";

/** One page of results is 20, plus up to 6 sponsored. 60 leaves room and caps abuse. */
const MAX_IDS = 60;

/**
 * How many visits opened each of these listings.
 *
 * ## Why this is a separate endpoint rather than a column on the job row
 *
 * `search_jobs` has 43 explicit OUT columns and `match_jobs_for` has 22, so
 * carrying `view_count` through them means dropping and recreating the two
 * busiest functions on the site. 0051 declined that once already, for the
 * company logo, and the reasoning has not changed.
 *
 * It also fixes a problem the column approach would have: the home page is
 * ISR-cached for five minutes, so a server-rendered count would be stale there
 * by construction while being live on search. Fetching after paint makes one
 * implementation correct on cached and uncached pages alike.
 *
 * ## Why the read client, not the admin client
 *
 * `job_view_counts` is STABLE and SECURITY INVOKER, so RLS on `jobs` still
 * applies and this cannot return a listing the caller could not already read.
 * Using the service role here would bypass that for no benefit — the numbers
 * are public, but "public" should still mean "public rows".
 */
export async function GET(request: Request) {
  if (!supabaseConfigured) return NextResponse.json({});

  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  /*
   * Validated as UUIDs before they reach Postgres. `p_ids` is a uuid[], so a
   * malformed member makes the whole call fail with a cast error rather than
   * returning the rows that were fine — one bad id on a page would blank every
   * counter on it.
   */
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
    .slice(0, MAX_IDS);

  if (!ids.length) return NextResponse.json({});

  const supabase = await createReadClient();
  const { data, error } = await supabase.rpc("job_view_counts", { p_ids: ids });

  if (error) {
    // A counter is decoration. It must never turn a working page into an error.
    console.error("[engagement] job_view_counts failed:", error.message);
    return NextResponse.json({});
  }

  const out: Record<string, number> = {};
  for (const row of (data as { id: string; views: number }[] | null) ?? []) {
    out[row.id] = row.views;
  }

  return NextResponse.json(out, {
    /*
     * A minute is plenty. Nobody is served by a view count that is exact to
     * the second, and this keeps a burst of search traffic off the database
     * for a number that changes slowly.
     */
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
