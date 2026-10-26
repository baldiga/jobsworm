import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Is the site actually working? One request, one honest answer.
 *
 * Built to be polled by something OUTSIDE this stack. That is the whole point:
 * on 2026-09-09 the database stopped accepting TCP connections and the first
 * anyone knew was a person opening the site on their phone. An alert that runs
 * on the infrastructure being watched is not an alert — when Vercel and
 * Supabase are the things that broke, a checker living in Vercel breaks with
 * them and stays quiet.
 *
 * WHAT IT CHECKS, and why these:
 *
 *   search   `search_jobs` through the ANON key, which is the exact path a
 *            visitor takes, including the 3-second statement timeout that
 *            anonymous requests get. A check that used the service role would
 *            have passed happily all through that outage, because the service
 *            role has a far longer timeout — it would have reported a healthy
 *            site to someone who could not search.
 *   count    proves the index is not empty. A database that answers instantly
 *            with zero jobs is not healthy, it is empty, and a naive check
 *            would call that a pass.
 *
 * STATUS CODES, chosen so a dumb HTTP monitor gets it right with no config:
 *   200  everything answered and there are jobs
 *   503  anything failed, or the index is empty
 *
 * Deliberately NOT cached and not counted in analytics.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Below this, something has gone wrong with ingestion rather than the DB. */
const MIN_HEALTHY_JOBS = 100;

export async function GET() {
  const started = Date.now();

  const urlEnv = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const keyEnv = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!urlEnv || !keyEnv) {
    return NextResponse.json(
      { ok: false, error: "supabase is not configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  // The anon key on purpose: same key, same RLS, same statement timeout as a
  // real visitor. See the note above.
  const supabase = createClient(urlEnv, keyEnv, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const checks: Record<string, { ok: boolean; ms: number; error?: string }> = {};

  async function check<T>(name: string, run: () => PromiseLike<{ data: T; error: { message: string } | null }>) {
    const t = Date.now();
    try {
      const { data, error } = await run();
      checks[name] = { ok: !error, ms: Date.now() - t, ...(error ? { error: error.message } : {}) };
      return error ? null : data;
    } catch (err) {
      checks[name] = {
        ok: false,
        ms: Date.now() - t,
        error: err instanceof Error ? err.message : "threw",
      };
      return null;
    }
  }

  const rows = await check("search", () =>
    supabase.rpc("search_jobs", { q: null, p_filters: {}, p_limit: 1, p_offset: 0 }),
  );
  const total = await check("count", () =>
    supabase.rpc("search_jobs_count", { q: null, p_filters: {} }),
  );

  const jobs = typeof total === "number" ? total : 0;
  const enough = jobs >= MIN_HEALTHY_JOBS;
  const ok = Object.values(checks).every((c) => c.ok) && Array.isArray(rows) && enough;

  return NextResponse.json(
    {
      ok,
      jobs,
      ms: Date.now() - started,
      checks,
      ...(ok ? {} : { error: enough ? "a database check failed" : `only ${jobs} open jobs` }),
    },
    {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store, no-cache, must-revalidate" },
    },
  );
}
