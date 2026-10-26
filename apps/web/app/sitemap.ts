import type { MetadataRoute } from "next";
import { createAdminClient, supabaseConfigured } from "@/lib/supabase";
import { SITE_URL as siteUrl } from "@/lib/site";

export const revalidate = 3600;

/**
 * Every open job page in the organic index is listed here. Organic search on
 * long-tail job queries is the acquisition loop (PLAN.md 7.1, section 11).
 * Agency listings are not organic and are left out; company pages were removed,
 * so they are no longer advertised here either.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base: MetadataRoute.Sitemap = [
    // The root carries the hero and the search box; it changes when the copy
    // changes, not when the index does. The hourly-churn entry is /jobs.
    { url: siteUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/jobs`, changeFrequency: "hourly", priority: 1 },
    { url: `${siteUrl}/match`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${siteUrl}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${siteUrl}/accessibility`, changeFrequency: "yearly", priority: 0.2 },
  ];

  if (!supabaseConfigured || !process.env.SUPABASE_SERVICE_ROLE_KEY) return base;

  try {
    const admin = createAdminClient();

    /*
     * Page through the rows.
     *
     * `.limit(20000)` looked like it fetched the whole index and did not:
     * PostgREST caps a response at `max-rows` (1,000 here) whatever the client
     * asks for, and returns the truncated page without an error. So this
     * sitemap has been advertising the newest 1,000 jobs and silently omitting
     * the other ~3,200 — on a site whose acquisition loop is Google finding
     * long-tail job pages. `.range()` is the only way to get past the cap.
     *
     * Ordering by id, not posted_at: a keyset that is unique and total, so a
     * row cannot be skipped or repeated across pages. Order has no meaning in
     * a sitemap anyway, and PAGE_LIMIT stops a runaway loop if the index ever
     * grows past what one sitemap should hold (the format's ceiling is 50,000).
     */
    const PAGE = 1000;
    const PAGE_LIMIT = 50;
    const jobs: { id: string; last_seen_at: string | null }[] = [];

    for (let page = 0; page < PAGE_LIMIT; page++) {
      const { data, error } = await admin
        .from("jobs")
        .select("id, last_seen_at")
        .eq("status", "open")
        // Agency listings are excluded from every search RPC, so submitting
        // them to Google advertises pages the site itself will not surface.
        .eq("is_agency", false)
        .order("id", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);

      if (error) throw new Error(error.message);
      if (!data?.length) break;
      jobs.push(...data);
      if (data.length < PAGE) break;
    }

    for (const j of jobs) {
      base.push({
        url: `${siteUrl}/jobs/${j.id}`,
        lastModified: j.last_seen_at ? new Date(j.last_seen_at) : undefined,
        changeFrequency: "daily",
        priority: 0.8,
      });
    }
  } catch {
    // A sitemap that is missing rows beats a 500.
  }

  return base;
}
