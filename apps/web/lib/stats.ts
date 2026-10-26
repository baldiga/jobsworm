import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfigured } from "./supabase";

/**
 * Public site counters, for the home page.
 *
 * Every number the home page states is queried here. The headline total and the
 * per-source rows come from the SAME aggregate inside `site_stats()`, so the
 * breakdown always adds up to its own total — summing separately-fetched counts
 * is how a page whose argument is "our numbers are real" ends up with rows that
 * disagree with their heading.
 *
 * Uses a plain anon client rather than `createReadClient`, because this data is
 * identical for every visitor and reading cookies would tie it to a request for
 * no reason. Wrapped in React `cache` so multiple components on one render
 * share a single round trip.
 */

/** Longest this may hold up a render or a build. See the note in getSiteStats. */
const STATS_TIMEOUT_MS = 4_000;

export type SourceCount = { provider: string; n: number };

export type SiteStats = {
  total: number;
  companies: number;
  /** Open jobs the agency gate excluded. */
  agencies: number;
  /** Times someone clicked through to an employer's own application page. */
  applications: number;
  /** Registered job seekers. */
  seekers: number;
  /** Distinct ATS providers present in the open index. */
  atsCount: number;
  /** Distinct Israeli job boards present in the open index. */
  boardCount: number;
  /** Approved, actively crawled public Facebook groups. */
  fbGroups: number;
  /** LinkedIn hiring posts currently in the index. */
  liPosts: number;
  sources: SourceCount[];
  newest: string | null;
  /** False when the query failed or Supabase is unconfigured. */
  ok: boolean;
};

const EMPTY: SiteStats = {
  total: 0,
  companies: 0,
  agencies: 0,
  applications: 0,
  seekers: 0,
  atsCount: 0,
  boardCount: 0,
  fbGroups: 0,
  liPosts: 0,
  sources: [],
  newest: null,
  ok: false,
};

export const getSiteStats = cache(async (): Promise<SiteStats> => {
  if (!supabaseConfigured) return EMPTY;

  try {
    /*
     * A hard deadline on every request this client makes.
     *
     * The home page is prerendered, so `site_stats` runs at BUILD time. On
     * 2026-09-10 the database was unreachable and the build failed outright —
     * "Failed to build /page: / after 3 attempts (took more than 60 seconds)"
     * — which meant that while the database was unwell we could not deploy the
     * fix for it either. A counter is decoration; it may never hold up a
     * deployment, and it may never make a visitor wait.
     *
     * Four seconds is longer than this query has ever legitimately taken (it
     * measures 0.3-1.7s) and short enough that a page still renders promptly
     * without it. On timeout the fetch aborts, getSiteStats returns EMPTY, and
     * the page simply omits the counter panel.
     */
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) =>
            fetch(input as RequestInfo, { ...init, signal: AbortSignal.timeout(STATS_TIMEOUT_MS) }),
        },
      },
    );

    /*
     * One retry on a timeout. site_stats is a single aggregate over the whole
     * open index, so it is the first thing to fail when the database is busy —
     * and when it fails the home page loses every number on it at once.
     */
    let { data, error } = await supabase.rpc("site_stats");
    // Retry only a statement timeout, which is usually a busy moment. An
    // aborted request means the database is not answering at all, and asking it
    // twice just doubles how long the page is held up.
    if (error && /statement timeout|canceling statement/i.test(error.message)) {
      await new Promise((r) => setTimeout(r, 500));
      ({ data, error } = await supabase.rpc("site_stats"));
    }
    if (error || !data) {
      // Silence here is how the home page went out showing four em-dashes and
      // nobody knew. It belongs in the log.
      console.error("[stats] site_stats failed:", error?.message ?? "no data");
      return EMPTY;
    }

    const raw = data as Record<string, unknown>;
    // count(*) returns bigint, which PostgREST serialises as a string.
    const num = (v: unknown) => Number(v ?? 0) || 0;

    return {
      total: num(raw.total),
      companies: num(raw.companies),
      agencies: num(raw.agencies),
      applications: num(raw.applications),
      seekers: num(raw.seekers),
      atsCount: num(raw.ats_count),
      boardCount: num(raw.board_count),
      fbGroups: num(raw.fb_groups),
      liPosts: num(raw.li_posts),
      newest: (raw.newest as string | null) ?? null,
      sources: ((raw.sources as { provider: string; n: unknown }[]) ?? [])
        .map((s) => ({ provider: s.provider, n: num(s.n) }))
        .filter((s) => s.n > 0),
      ok: true,
    };
  } catch {
    // A counter must never take the whole page down.
    return EMPTY;
  }
});

/** Display name and category for each source. */
export const SOURCE_LABEL: Record<string, { label: string; kind: string }> = {
  drushim: { label: "Drushim", kind: "Job board" },
  comeet: { label: "Comeet", kind: "Hiring software" },
  facebook: { label: "Facebook groups", kind: "Social" },
  linkedin: { label: "LinkedIn posts", kind: "Social" },
  greenhouse: { label: "Greenhouse", kind: "Hiring software" },
  alljobs: { label: "AllJobs", kind: "Job board" },
  ashby: { label: "Ashby", kind: "Hiring software" },
  lever: { label: "Lever", kind: "Hiring software" },
  smartrecruiters: { label: "SmartRecruiters", kind: "Hiring software" },
  workable: { label: "Workable", kind: "Hiring software" },
  recruitee: { label: "Recruitee", kind: "Hiring software" },
  secrettelaviv: { label: "Secret Tel Aviv", kind: "Job board" },
  workday: { label: "Workday", kind: "Hiring software" },
  personio: { label: "Personio", kind: "Hiring software" },
  bamboohr: { label: "BambooHR", kind: "Hiring software" },
  yad2: { label: "Yad2", kind: "Job board" },
  drushimavodot: { label: "Drushim-Avodot", kind: "Job board" },
  revhub: { label: "RevHub", kind: "Community" },
};

export function sourceLabel(provider: string) {
  return SOURCE_LABEL[provider] ?? { label: provider, kind: "Source" };
}

/** "4 hours ago" style freshness for the "last updated" counter. */
export function freshness(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function compact(n: number): string {
  return n.toLocaleString("en-US");
}
