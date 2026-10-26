import { NextResponse } from "next/server";

export const runtime = "nodejs";
/*
 * 300s, up from 60.
 *
 * The old budget was the real limit on this crawler, and not by a little. A
 * pass asked to lease 40 companies but had 45 seconds to do it, and a company
 * takes about five seconds — so it managed eight or nine and released the rest.
 * With 288 companies on the list it therefore ran permanently behind, and the
 * backlog was cleared by hand twice on 2026-09-13 alone. It gets worse with
 * every company added, which is the wrong way for a growth lever to scale.
 *
 * 300s is the platform default ceiling now, and it makes the requested limit
 * the real one.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Vercel Cron entry point for ATS ingestion (PLAN.md 4.2).
 *
 * ## Two schedules, both in `vercel.json`, which cannot carry a comment
 *
 * FOUR passes at 00:00, 00:10, 00:20 and 00:30 UTC — 03:00 in Israel, when the
 * site is asleep — do the bulk of the work where no visitor is competing for
 * the database. They are clear of the pg_cron jobs too: the purge runs at
 * 02:40 UTC and the dedupe at 03:00 UTC, both hours away.
 *
 * Four passes rather than one big one, because the limit is not what bounds a
 * pass — the budget is. A company takes five or six seconds, so 280 seconds
 * fits about fifty however large a number the caller asks for. Asking one pass
 * for 200 would simply have leased 200 and crawled a quarter of them, which is
 * how the old 45-second budget managed nine out of forty. Ten minutes apart so
 * a slow pass finishes before the next begins.
 *
 * A light hourly pass at :07 takes twenty. Partly freshness — a board that
 * posts in the morning should not wait until the following night to appear,
 * and a job closed at noon should not be applied to all afternoon. Partly
 * arithmetic, which is worth writing down because the first version of this
 * split got it wrong.
 *
 * Demand on 2026-09-14: 247 companies on a 12-hour interval, 16 on 4 hours and
 * 25 on 48 is 603 crawls a day. Four nightly passes supply about 200. Twelve an
 * hour supplies 288, so the pair came to 488 and the backlog would have kept
 * growing — better than the 216 a day the old 45-second budget managed, but
 * still short. Twenty an hour is 480, and 680 against 603 leaves room for the
 * list to grow before this needs looking at again.
 *
 * The split exists because one number could not do both jobs. Hourly-and-large
 * put a write burst into peak hours; nightly-only made the index a day stale.
 *
 * ATS is the largest source — about 52% of the open index — and this is the
 * only scheduler it has: the GitHub Actions passes cover the scraped sources
 * and never touch it. Between 2026-09-09 and this cron landing, ATS jobs
 * arrived only when somebody ran `pnpm ingest:once` by hand.
 *
 * At :07 rather than on the hour, so it does not land with every other cron on
 * the internet, and clear of the PostHog rollup at :17.
 *
 * The lease loop itself lives in @jobsworm/adapters so the same code runs from
 * `pnpm ingest:once` locally. This route is a thin authenticated wrapper with
 * a per-invocation cap.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 12) || 12);

  try {
    const { runIngestPass } = await import("@jobsworm/adapters/ingest");
    const summary = await runIngestPass({
      limit,
      // Leave headroom under maxDuration so the lease is always released.
      budgetMs: 280_000,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("ingest failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "ingest failed" },
      { status: 500 },
    );
  }
}
