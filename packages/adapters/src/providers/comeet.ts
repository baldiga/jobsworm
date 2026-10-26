/**
 * Comeet — PLAN.md section 4.2. The most common ATS among Israeli employers.
 *
 * GET https://www.comeet.co/careers-api/2.0/company/{uid}/positions
 *       ?token={token}&details=true
 *
 * The `uid` and `token` are both embedded in the employer's own careers page,
 * so the feed is public. We store them together as `"{uid}::{token}"` in
 * `companies.ats_token`.
 *
 * Observed live shape (verified against abra / 15.007):
 *   [ { uid: "AB.D67",
 *       name: "Aeromechanical Engineer",
 *       department: "Professional Services",
 *       location: { name, city, state, country: "IL", is_remote },
 *       employment_type: "Full-time",
 *       experience_level: "Medium",
 *       workplace_type: "On-site" | "Hybrid" | "Remote",
 *       time_updated: "2026-08-31T05:03:43Z",
 *       url_comeet_hosted_page, url_active_page,
 *       details: [ { name: "Description", value: "<p>…" },
 *                  { name: "Requirements", value: "<p>…" } ] } ]
 *
 * Without `details=true` the payload carries no description at all, so that
 * parameter is mandatory rather than an optimization.
 */

import { fetchJson } from "../http";
import type { Adapter, DetectResult, FetchOptions, RawJob } from "../types";

interface ComeetDetail {
  name?: string;
  value?: string;
}

interface ComeetLocation {
  name?: string;
  city?: string;
  state?: string;
  country?: string;
  is_remote?: boolean;
}

interface ComeetPosition {
  uid?: string;
  name?: string;
  department?: string;
  location?: ComeetLocation | null;
  employment_type?: string;
  experience_level?: string;
  workplace_type?: string;
  time_updated?: string | null;
  url_comeet_hosted_page?: string;
  url_active_page?: string;
  details?: ComeetDetail[] | null;
}

export const BASE = "https://www.comeet.co/careers-api/2.0/company";

/** `companies.ats_token` holds "uid::token". */
export function splitToken(stored: string): { uid: string; token: string } {
  const idx = stored.indexOf("::");
  if (idx === -1) {
    throw new Error(
      `Comeet token must be stored as "uid::token", received "${stored.slice(0, 24)}…"`,
    );
  }
  return { uid: stored.slice(0, idx), token: stored.slice(idx + 2) };
}

function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function locationOf(loc: ComeetLocation | null | undefined): string {
  if (!loc) return "";
  const parts = [loc.name, loc.city, loc.state].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  const seen = new Set<string>();
  const unique = parts.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (loc.is_remote) unique.push("Remote");
  return unique.join(", ");
}

/**
 * Comeet splits the posting across named detail sections. Keeping the section
 * headings lets the decomposition rules tell "Requirements" from "Advantage".
 */
function descriptionOf(details: ComeetDetail[] | null | undefined): string {
  if (!Array.isArray(details) || details.length === 0) return "";
  return details
    .filter((d) => d?.value)
    .map((d) => (d.name ? `<h3>${d.name}</h3>\n${d.value}` : String(d.value)))
    .join("\n");
}

/** Comeet states the arrangement outright, so we pass it through as a cue. */
function workplaceCue(position: ComeetPosition): string {
  const w = (position.workplace_type ?? "").toLowerCase();
  if (w.includes("hybrid")) return "Hybrid";
  if (w.includes("remote")) return "Remote";
  if (w.includes("site") || w.includes("office")) return "On-site";
  return "";
}

export const comeet: Adapter = {
  provider: "comeet",

  buildFeedUrl(stored: string): string {
    const { uid, token } = splitToken(stored);
    return `${BASE}/${encodeURIComponent(uid)}/positions?token=${encodeURIComponent(token)}&details=true`;
  },

  async fetchJobs(stored: string, options: FetchOptions = {}): Promise<RawJob[]> {
    const data = await fetchJson<ComeetPosition[] | { positions?: ComeetPosition[] }>(
      comeet.buildFeedUrl(stored),
      { signal: options.signal },
    );

    const positions = Array.isArray(data) ? data : (data.positions ?? []);
    const limited = options.maxJobs ? positions.slice(0, options.maxJobs) : positions;

    return limited
      .filter((p) => p.uid && p.name)
      .map((p) => {
        const cue = workplaceCue(p);
        const locationRaw = [locationOf(p.location), cue].filter(Boolean).join(", ");
        return {
          externalId: String(p.uid),
          title: String(p.name).trim(),
          descriptionHtml: descriptionOf(p.details),
          locationRaw,
          postedAt: toIso(p.time_updated),
          applyUrl: p.url_comeet_hosted_page || p.url_active_page || "",
          department: p.department ?? undefined,
        } satisfies RawJob;
      })
      .filter((j) => j.applyUrl.length > 0);
  },

  /**
   * Careers pages embed the pair either in the API URL itself or in a Comeet
   * config object. Both forms appear in the wild.
   */
  detect(html: string): DetectResult | null {
    const direct =
      /comeet\.co\/careers-api\/2\.0\/company\/([0-9A-Za-z.]{2,20})\/positions\?token=([0-9A-Fa-f]{16,64})/.exec(
        html,
      );
    if (direct) {
      const stored = `${direct[1]}::${direct[2]}`;
      return { token: stored, feedUrl: comeet.buildFeedUrl(stored) };
    }

    const uid = /["']?(?:company_?uid|comeetCompanyUid|uid)["']?\s*[:=]\s*["']([0-9A-Za-z.]{2,20})["']/.exec(
      html,
    );
    const token = /["']?(?:comeet_?token|token)["']?\s*[:=]\s*["']([0-9A-Fa-f]{16,64})["']/.exec(html);
    if (uid && token) {
      const stored = `${uid[1]}::${token[1]}`;
      return { token: stored, feedUrl: comeet.buildFeedUrl(stored) };
    }

    return null;
  },
};
