/**
 * Lever postings API — PLAN.md section 4.2.
 *
 * GET https://api.lever.co/v0/postings/{token}?mode=json
 *
 * Observed shape (verified live against `spotify`, `palantir`):
 *   [ { id, text, hostedUrl, applyUrl, createdAt (epoch ms), country,
 *       workplaceType, description, descriptionPlain,
 *       lists: [ { text, content } ],           // Requirements / Nice-to-have
 *       additional, additionalPlain,
 *       categories: { commitment, department, location, team, allLocations } } ]
 *
 * `description` alone is only the intro paragraph — the requirements live in
 * `lists`, so the description HTML is reassembled from all three parts or the
 * section splitter has nothing to work with.
 */

import { fetchJson } from "../http";
import type { Adapter, DetectResult, FetchOptions, RawJob } from "../types";

interface LeverList {
  text?: string;
  content?: string;
}

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  country?: string;
  workplaceType?: string;
  description?: string;
  descriptionPlain?: string;
  lists?: LeverList[];
  additional?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string } | null;
  salaryDescription?: string | null;
  categories?: {
    commitment?: string;
    department?: string;
    location?: string;
    team?: string;
    allLocations?: string[];
  } | null;
}

export const BASE = "https://api.lever.co/v0/postings";

function locationOf(p: LeverPosting): string {
  const cats = p.categories ?? {};
  const all = Array.isArray(cats.allLocations) ? cats.allLocations : [];
  const names = [...new Set([cats.location, ...all].filter((x): x is string => Boolean(x)))];
  const workplace = p.workplaceType ? ` (${p.workplaceType})` : "";
  return `${names.join(" / ")}${workplace}`.trim();
}

function buildHtml(p: LeverPosting): string {
  const parts: string[] = [];
  if (p.description) parts.push(p.description);
  for (const list of p.lists ?? []) {
    if (list.text) parts.push(`<h3>${list.text}</h3>`);
    if (list.content) parts.push(`<ul>${list.content}</ul>`);
  }
  if (p.additional) parts.push(p.additional);
  if (parts.length === 0 && p.descriptionPlain) parts.push(`<p>${p.descriptionPlain}</p>`);
  return parts.join("\n");
}

function salaryOf(p: LeverPosting): string | undefined {
  if (p.salaryDescription) return p.salaryDescription;
  const r = p.salaryRange;
  if (!r || (r.min == null && r.max == null)) return undefined;
  const range = [r.min, r.max].filter((x) => x != null).join(" - ");
  return `${r.currency ?? ""} ${range}${r.interval ? ` per ${r.interval}` : ""}`.trim();
}

export const lever: Adapter = {
  provider: "lever",

  buildFeedUrl(token: string): string {
    return `${BASE}/${encodeURIComponent(token)}?mode=json`;
  },

  async fetchJobs(token: string, options: FetchOptions = {}): Promise<RawJob[]> {
    const data = await fetchJson<LeverPosting[]>(lever.buildFeedUrl(token), {
      signal: options.signal,
    });
    const postings = Array.isArray(data) ? data : [];
    const limited = options.maxJobs ? postings.slice(0, options.maxJobs) : postings;

    return limited.map((p) => ({
      externalId: String(p.id ?? p.hostedUrl ?? ""),
      title: (p.text ?? "").trim(),
      descriptionHtml: buildHtml(p),
      locationRaw: locationOf(p),
      postedAt:
        typeof p.createdAt === "number" && Number.isFinite(p.createdAt)
          ? new Date(p.createdAt).toISOString()
          : null,
      applyUrl: p.hostedUrl ?? p.applyUrl ?? `https://jobs.lever.co/${token}/${p.id ?? ""}`,
      department: p.categories?.department ?? p.categories?.team ?? undefined,
      salaryRaw: salaryOf(p),
    }));
  },

  detect(html: string): DetectResult | null {
    const patterns = [
      /jobs\.(?:eu\.)?lever\.co\/([A-Za-z0-9_-]{2,60})/i,
      /api\.lever\.co\/v0\/postings\/([A-Za-z0-9_-]{2,60})/i,
      /["']?leverSite["']?\s*[:=]\s*["']([A-Za-z0-9_-]{2,60})["']/i,
    ];
    for (const re of patterns) {
      const token = re.exec(html)?.[1];
      if (token) return { token, feedUrl: lever.buildFeedUrl(token) };
    }
    return null;
  },
};
