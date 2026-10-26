/**
 * Recruitee - PLAN.md section 4.2.
 *
 * GET https://{subdomain}.recruitee.com/api/offers/
 *
 * Observed live (verified against `aikidosecurity`): the list already carries
 * `description` and `requirements` as HTML, so no detail call is needed.
 */

import { fetchJson } from "../http";
import type { Adapter, DetectResult, FetchOptions, RawJob } from "../types";

interface RtOffer {
  id?: number | string;
  slug?: string;
  title?: string;
  description?: string | null;
  requirements?: string | null;
  location?: string | null;
  city?: string | null;
  state_name?: string | null;
  country_code?: string | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
  department?: string | null;
  employment_type_code?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  careers_url?: string | null;
  careers_apply_url?: string | null;
}

interface RtResponse {
  offers?: RtOffer[];
}

function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function locationOf(offer: RtOffer): string {
  const parts = [offer.location, offer.city, offer.state_name].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  const seen = new Set<string>();
  const unique = parts.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (offer.remote) unique.push("Remote");
  else if (offer.hybrid) unique.push("Hybrid");
  return unique.join(", ");
}

function bodyOf(offer: RtOffer): string {
  const parts: string[] = [];
  if (offer.description) parts.push(String(offer.description));
  if (offer.requirements) parts.push(`<h3>Requirements</h3>\n${offer.requirements}`);
  return parts.join("\n");
}

export const recruitee: Adapter = {
  provider: "recruitee",

  buildFeedUrl(token: string): string {
    return `https://${encodeURIComponent(token)}.recruitee.com/api/offers/`;
  },

  async fetchJobs(token: string, options: FetchOptions = {}): Promise<RawJob[]> {
    const data = await fetchJson<RtResponse>(recruitee.buildFeedUrl(token), {
      signal: options.signal,
    });
    const offers = data.offers ?? [];
    const limited = options.maxJobs ? offers.slice(0, options.maxJobs) : offers;

    return limited
      .filter((o) => o.id && o.title)
      .map((o) => ({
        externalId: String(o.id),
        title: String(o.title).trim(),
        descriptionHtml: bodyOf(o),
        locationRaw: locationOf(o),
        postedAt: toIso(o.published_at ?? o.created_at),
        applyUrl:
          o.careers_apply_url ||
          o.careers_url ||
          `https://${token}.recruitee.com/o/${o.slug ?? o.id}`,
        department: o.department ?? undefined,
      }));
  },

  detect(html: string): DetectResult | null {
    const token = /([A-Za-z0-9_-]{2,60})\.recruitee\.com/i.exec(html)?.[1];
    if (!token || token === "www") return null;
    return { token, feedUrl: recruitee.buildFeedUrl(token) };
  },
};
