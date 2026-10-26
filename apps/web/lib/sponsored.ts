import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfigured } from "./supabase";
import type { JobRow, SearchFilters } from "./types";

/**
 * Fetching the paid surface.
 *
 * ## It may never hold up a page
 *
 * A sponsored strip is the least important thing on any page it appears on. If
 * the query is slow, errors, or the database is unwell, the correct outcome is
 * a page with no sponsored cards — not a slow page, and certainly not an
 * error. Every failure here returns an empty array.
 *
 * The four-second deadline is the same one `lib/stats.ts` carries, for the
 * same reason: the home page is prerendered, so this runs at BUILD time, and
 * on 2026-09-10 an unreachable database failed the build outright. Advertising
 * may not be able to stop a deployment.
 *
 * ## Anonymous client, deliberately
 *
 * `sponsored_jobs` is granted to `anon`. Using the anon key here rather than a
 * server client with the reader's session means the paid surface is identical
 * for everyone — no possibility of a signed-in reader being shown a different
 * set, and no session cookie in the path of a query that is the same for the
 * whole world and therefore cacheable.
 */

const TIMEOUT_MS = 4000;

export async function getSponsoredJobs(
  q: string | null,
  filters: SearchFilters,
  limit: number,
): Promise<JobRow[]> {
  if (!supabaseConfigured) return [];

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) =>
            fetch(input as RequestInfo, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }),
        },
      },
    );

    const { data, error } = await supabase.rpc("sponsored_jobs", {
      q,
      p_filters: filters,
      p_limit: limit,
    });

    if (error) {
      // Logged, not thrown. Silence is how a broken panel ships unnoticed —
      // but a broken advert panel must not break the page it sits on.
      console.error("[sponsored] sponsored_jobs failed:", error.message);
      return [];
    }
    return (data ?? []) as JobRow[];
  } catch (err) {
    console.error("[sponsored] sponsored_jobs threw:", err instanceof Error ? err.message : err);
    return [];
  }
}
