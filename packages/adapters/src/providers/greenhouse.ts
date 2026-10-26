/**
 * Greenhouse job board — PLAN.md section 4.2.
 *
 * GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 *
 * Observed shape (verified live against `fireblocks`, `similarweb`, `riskified`):
 *   { jobs: [ { id, internal_job_id, title, updated_at, first_published,
 *               absolute_url, location: { name }, content,
 *               departments: [{ name }], offices: [{ name }] } ],
 *     meta: { total } }
 *
 * `content` is HTML-escaped once ("&lt;div&gt;..."), so it must be unescaped
 * before it is treated as markup.
 */

import { decodeEntities } from "@jobsworm/core";

import { fetchJson } from "../http";
import type { Adapter, DetectResult, FetchOptions, RawJob } from "../types";

interface GhJob {
  id: number | string;
  internal_job_id?: number | string;
  title?: string;
  updated_at?: string | null;
  first_published?: string | null;
  absolute_url?: string;
  content?: string;
  location?: { name?: string } | null;
  offices?: Array<{ name?: string }> | null;
  departments?: Array<{ name?: string }> | null;
}

interface GhResponse {
  jobs?: GhJob[];
}

export const BASE = "https://boards-api.greenhouse.io/v1/boards";

function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function locationOf(job: GhJob): string {
  const parts = [job.location?.name, ...(job.offices ?? []).map((o) => o?.name)];
  const seen = new Set<string>();
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .filter((p) => {
      const k = p.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(", ");
}

export const greenhouse: Adapter = {
  provider: "greenhouse",

  buildFeedUrl(token: string): string {
    return `${BASE}/${encodeURIComponent(token)}/jobs?content=true`;
  },

  async fetchJobs(token: string, options: FetchOptions = {}): Promise<RawJob[]> {
    const data = await fetchJson<GhResponse>(greenhouse.buildFeedUrl(token), {
      signal: options.signal,
    });
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    const limited = options.maxJobs ? jobs.slice(0, options.maxJobs) : jobs;

    return limited.map((j) => ({
      externalId: String(j.id),
      title: (j.title ?? "").trim(),
      // content arrives entity-escaped; one decode turns it back into markup
      descriptionHtml: decodeEntities(j.content ?? ""),
      locationRaw: locationOf(j),
      postedAt: toIso(j.first_published ?? j.updated_at),
      applyUrl: j.absolute_url ?? `https://job-boards.greenhouse.io/${token}/jobs/${j.id}`,
      department: j.departments?.[0]?.name ?? undefined,
    }));
  },

  detect(html: string): DetectResult | null {
    const patterns = [
      /boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([A-Za-z0-9_-]{2,60})/i,
      /job-boards\.greenhouse\.io\/([A-Za-z0-9_-]{2,60})/i,
      /Grnhse\.Settings\s*=\s*\{[^}]*boardToken\s*:\s*["']([A-Za-z0-9_-]{2,60})["']/i,
      /["']?boardToken["']?\s*[:=]\s*["']([A-Za-z0-9_-]{2,60})["']/i,
    ];
    for (const re of patterns) {
      const m = re.exec(html);
      const token = m?.[1];
      if (token && token !== "embed" && token !== "v1") {
        return { token, feedUrl: greenhouse.buildFeedUrl(token) };
      }
    }
    return null;
  },
};
