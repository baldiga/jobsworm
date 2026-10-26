/**
 * SmartRecruiters - PLAN.md section 4.2.
 *
 * List:   GET https://api.smartrecruiters.com/v1/companies/{company}/postings?limit=100&offset=N
 * Detail: GET https://api.smartrecruiters.com/v1/companies/{company}/postings/{id}
 *
 * Observed live (verified against `Wix2`): the list carries no description at
 * all, so the body has to come from the per-posting detail call. We cap the
 * number of detail fetches per company and leave the rest with an empty body,
 * so one large employer cannot exhaust a cron budget.
 */

import { fetchJson, mapLimit } from "../http";
import type { Adapter, DetectResult, FetchOptions, RawJob } from "../types";

const MAX_DETAIL_FETCHES = 100;
const PAGE = 100;

interface SrLocation {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
  fullLocation?: string;
}

interface SrPosting {
  id: string;
  name?: string;
  releasedDate?: string | null;
  location?: SrLocation | null;
  department?: { label?: string } | null;
}

interface SrList {
  totalFound?: number;
  content?: SrPosting[];
}

interface SrSection {
  title?: string;
  text?: string;
}

interface SrDetail {
  jobAd?: {
    sections?: {
      companyDescription?: SrSection;
      jobDescription?: SrSection;
      qualifications?: SrSection;
      additionalInformation?: SrSection;
    };
  };
}

export const BASE = "https://api.smartrecruiters.com/v1/companies";

function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function locationOf(loc: SrLocation | null | undefined): string {
  if (!loc) return "";
  if (loc.fullLocation) return loc.remote ? `${loc.fullLocation}, Remote` : loc.fullLocation;
  const parts = [loc.city, loc.region, loc.country].filter(Boolean) as string[];
  if (loc.remote) parts.push("Remote");
  return parts.join(", ");
}

function sectionsToHtml(detail: SrDetail): string {
  const s = detail.jobAd?.sections;
  if (!s) return "";
  return [s.companyDescription, s.jobDescription, s.qualifications, s.additionalInformation]
    .filter((sec): sec is SrSection => Boolean(sec?.text))
    .map((sec) => (sec.title ? `<h3>${sec.title}</h3>\n${sec.text}` : String(sec.text)))
    .join("\n");
}

export const smartrecruiters: Adapter = {
  provider: "smartrecruiters",

  buildFeedUrl(token: string): string {
    return `${BASE}/${encodeURIComponent(token)}/postings?limit=${PAGE}`;
  },

  async fetchJobs(token: string, options: FetchOptions = {}): Promise<RawJob[]> {
    const company = encodeURIComponent(token);
    const postings: SrPosting[] = [];
    const hardCap = options.maxJobs ?? 400;

    for (let offset = 0; offset < hardCap; offset += PAGE) {
      const page = await fetchJson<SrList>(
        `${BASE}/${company}/postings?limit=${PAGE}&offset=${offset}`,
        { signal: options.signal },
      );
      const batch = page.content ?? [];
      postings.push(...batch);
      if (batch.length < PAGE) break;
    }

    const capped = postings.slice(0, hardCap);
    const detailTargets = capped.slice(0, MAX_DETAIL_FETCHES);

    const details = await mapLimit(detailTargets, 4, async (p) => {
      try {
        const d = await fetchJson<SrDetail>(`${BASE}/${company}/postings/${p.id}`, {
          signal: options.signal,
        });
        return [p.id, sectionsToHtml(d)] as const;
      } catch {
        // A single unavailable posting must not fail the whole company.
        return [p.id, ""] as const;
      }
    });

    const bodyById = new Map(details);

    return capped.map((p) => ({
      externalId: String(p.id),
      title: (p.name ?? "").trim(),
      descriptionHtml: bodyById.get(p.id) ?? "",
      locationRaw: locationOf(p.location),
      postedAt: toIso(p.releasedDate),
      applyUrl: `https://jobs.smartrecruiters.com/${token}/${p.id}`,
      department: p.department?.label ?? undefined,
    }));
  },

  detect(html: string): DetectResult | null {
    const patterns = [
      /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]{2,60})/i,
      /api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9_-]{2,60})/i,
    ];
    for (const re of patterns) {
      const token = re.exec(html)?.[1];
      if (token) return { token, feedUrl: smartrecruiters.buildFeedUrl(token) };
    }
    return null;
  },
};
