/**
 * Ashby job board — PLAN.md section 4.2.
 *
 * GET https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true
 *
 * Observed shape (verified live against `ashby`):
 *   { apiVersion, jobs: [ { id, title, department, team, employmentType,
 *       location, secondaryLocations: [{ location }], publishedAt, isListed,
 *       isRemote, workplaceType, address, jobUrl, applyUrl,
 *       descriptionHtml, descriptionPlain,
 *       compensation: { compensationTierSummary,
 *                       scrapeableCompensationSalarySummary } } ] }
 */

import { fetchJson } from "../http";
import type { Adapter, DetectResult, FetchOptions, RawJob } from "../types";

interface AshbySecondaryLocation {
  location?: string;
}

interface AshbyCompensation {
  compensationTierSummary?: string | null;
  scrapeableCompensationSalarySummary?: string | null;
}

interface AshbyJob {
  id?: string;
  title?: string;
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  secondaryLocations?: AshbySecondaryLocation[];
  publishedAt?: string | null;
  updatedAt?: string | null;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: AshbyCompensation | null;
}

interface AshbyResponse {
  jobs?: AshbyJob[];
}

export const BASE = "https://api.ashbyhq.com/posting-api/job-board";

function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function locationOf(j: AshbyJob): string {
  const names = [j.location, ...(j.secondaryLocations ?? []).map((s) => s?.location)].filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  const unique = [...new Set(names)];
  // workplaceType is the only structural remote signal Ashby exposes.
  const mode = j.workplaceType ?? (j.isRemote ? "Remote" : "");
  return `${unique.join(" / ")}${mode ? ` (${mode})` : ""}`.trim();
}

function salaryOf(j: AshbyJob): string | undefined {
  const c = j.compensation;
  if (!c) return undefined;
  return c.compensationTierSummary ?? c.scrapeableCompensationSalarySummary ?? undefined;
}

export const ashby: Adapter = {
  provider: "ashby",

  buildFeedUrl(token: string): string {
    return `${BASE}/${encodeURIComponent(token)}?includeCompensation=true`;
  },

  async fetchJobs(token: string, options: FetchOptions = {}): Promise<RawJob[]> {
    const data = await fetchJson<AshbyResponse>(ashby.buildFeedUrl(token), {
      signal: options.signal,
    });
    const jobs = (Array.isArray(data.jobs) ? data.jobs : []).filter((j) => j.isListed !== false);
    const limited = options.maxJobs ? jobs.slice(0, options.maxJobs) : jobs;

    return limited.map((j) => ({
      externalId: String(j.id ?? j.jobUrl ?? ""),
      title: (j.title ?? "").trim(),
      descriptionHtml:
        j.descriptionHtml ?? (j.descriptionPlain ? `<p>${j.descriptionPlain}</p>` : ""),
      locationRaw: locationOf(j),
      postedAt: toIso(j.publishedAt ?? j.updatedAt),
      applyUrl: j.jobUrl ?? j.applyUrl ?? `https://jobs.ashbyhq.com/${token}/${j.id ?? ""}`,
      department: j.department ?? j.team ?? undefined,
      salaryRaw: salaryOf(j),
    }));
  },

  detect(html: string): DetectResult | null {
    const patterns = [
      /jobs\.ashbyhq\.com\/([A-Za-z0-9_.-]{2,60})/i,
      /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9_.-]{2,60})/i,
      /["']?ashby_?(?:embed_?)?job_?board_?name["']?\s*[:=]\s*["']([A-Za-z0-9_.-]{2,60})["']/i,
    ];
    for (const re of patterns) {
      const token = re.exec(html)?.[1];
      if (token && token !== "embed") return { token, feedUrl: ashby.buildFeedUrl(token) };
    }
    return null;
  },
};
