import { NextResponse } from "next/server";
import { hogql, posthogQueryConfigured } from "@/lib/posthog-query";
import { createAdminClient, supabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Hourly: copy PostHog's counts into our own tables.
 *
 * ## Why a rollup at all, rather than querying PostHog from the dashboard
 *
 * Three reasons, in order of how much they matter.
 *
 * Ownership. A recruiter may see their own campaign's numbers and nobody
 * else's. Enforcing that against a shared analytics project means trusting a
 * query string; enforcing it against our own tables means `auth.uid()` in an
 * RPC, which is the same mechanism guarding everything else on the site.
 *
 * Cost of a page view. PostHog's query API is rate-limited (240/min) and
 * routinely takes seconds. A dashboard that queried it directly would be slow
 * on every load and would fall over exactly when several recruiters looked at
 * once.
 *
 * Survivability. If PostHog is down, or the plan lapses, or the key is
 * rotated, the recruiter still sees yesterday's numbers rather than an error.
 *
 * ## Two days, every hour
 *
 * Each run re-reads the last two days rather than the last hour. Events arrive
 * late — a beacon fired as somebody closes a tab can land minutes afterwards,
 * and PostHog's own ingestion is not instantaneous — so an hourly window would
 * permanently undercount the edges. Re-reading is idempotent because both
 * upserts are keyed by day.
 *
 * `toDate()` buckets in the PostHog project's timezone, which is why that
 * setting is Asia/Jerusalem: a recruiter comparing "yesterday" against their
 * own calendar should not be off by three hours.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!posthogQueryConfigured()) {
    // Not an error: the whole analytics stack is optional and the site works
    // without it. Say so plainly so a green cron with no rows is explicable.
    return NextResponse.json({ ok: true, skipped: "posthog not configured" });
  }
  if (!supabaseConfigured) {
    return NextResponse.json({ ok: false, error: "supabase not configured" }, { status: 503 });
  }

  const site = await hogql(`
    SELECT toDate(timestamp) AS day,
           countIf(event = '$pageview')                            AS visits,
           uniqIf(distinct_id, event = '$pageview')                AS unique_visitors,
           countIf(event = 'search' AND properties.page = 1)       AS searches
    FROM events
    WHERE timestamp >= now() - INTERVAL 2 DAY
      AND event IN ('$pageview', 'search')
    GROUP BY day
  `);

  const campaigns = await hogql(`
    SELECT toDate(timestamp) AS day,
           properties.campaign_id AS campaign_id,
           countIf(event = 'sponsored_impression' AND properties.surface = 'home')   AS impressions_home,
           countIf(event = 'sponsored_impression' AND properties.surface = 'search') AS impressions_search,
           countIf(event = 'sponsored_job_view')                                     AS card_views,
           countIf(event = 'apply_click')                                            AS apply_clicks
    FROM events
    WHERE timestamp >= now() - INTERVAL 2 DAY
      AND event IN ('sponsored_impression', 'sponsored_job_view', 'apply_click')
      AND properties.campaign_id IS NOT NULL
      AND properties.campaign_id != ''
    GROUP BY day, campaign_id
  `);

  const admin = createAdminClient();
  const written = { site: 0, campaigns: 0 };
  const notes: string[] = [];

  if (site?.results?.length) {
    const rows = site.results.map((r) => ({
      day: String(r[0]),
      visits: Number(r[1]) || 0,
      unique_visitors: Number(r[2]) || 0,
      searches: Number(r[3]) || 0,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await admin.from("site_stats_daily").upsert(rows, { onConflict: "day" });
    // The tables land in Phase 2. Until then the queries are exercised every
    // hour and the write is expected to fail — which is worth knowing about,
    // and is not worth failing the cron over.
    if (error) notes.push(`site_stats_daily: ${error.message}`);
    else written.site = rows.length;
  }

  if (campaigns?.results?.length) {
    /*
     * `campaign_id` arrives from a browser, so it is untrusted input that is
     * about to be used as a foreign key. Filter it against real campaigns
     * first: without this, one crafted beacon turns every hourly run into a
     * constraint violation that discards the honest rows alongside it.
     */
    const ids = [...new Set(campaigns.results.map((r) => String(r[1])).filter(Boolean))];
    const { data: known } = await admin.from("campaigns").select("id").in("id", ids);
    const valid = new Set((known ?? []).map((c: { id: string }) => c.id));

    const rows = campaigns.results
      .filter((r) => valid.has(String(r[1])))
      .map((r) => ({
        day: String(r[0]),
        campaign_id: String(r[1]),
        impressions_home: Number(r[2]) || 0,
        impressions_search: Number(r[3]) || 0,
        card_views: Number(r[4]) || 0,
        apply_clicks: Number(r[5]) || 0,
        updated_at: new Date().toISOString(),
      }));

    if (rows.length) {
      const { error } = await admin
        .from("campaign_stats_daily")
        .upsert(rows, { onConflict: "campaign_id,day" });
      if (error) notes.push(`campaign_stats_daily: ${error.message}`);
      else written.campaigns = rows.length;
    }
  }

  return NextResponse.json({
    ok: true,
    read: { site: site?.results?.length ?? 0, campaigns: campaigns?.results?.length ?? 0 },
    written,
    notes,
  });
}
