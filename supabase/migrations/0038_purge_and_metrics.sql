-- 0038_purge_and_metrics.sql — enforce the retention promise, and write down
-- what the index looked like each day.
--
-- Two jobs that have never existed, both of which should have from day one.
--
-- ## purge_raw_cache
--
-- `raw_pages` and `raw_posts` are commented in 0003 with retention periods —
-- 14 days and 30 days — and nothing has ever deleted a row from either. The
-- comment is a promise the schema makes and the database does not keep. For
-- `raw_posts` that promise is not only about disk: those rows are cached
-- Facebook and LinkedIn post text, which is exactly the material PLAN.md 4.3
-- says is kept only long enough to re-parse.
--
-- ## record_daily_metrics
--
-- The `metrics` table exists, has a unique key on (key, bucket_at, dims), and
-- is empty. Without a daily snapshot there is no way to answer "when did the
-- index start shrinking" — only "it is smaller now than I remember", which is
-- how 332 foreign jobs sat unnoticed for a month.

-- ---------------------------------------------------------------------------
-- purge_raw_cache(p_limit) — batched, like everything else in 0037.
--
-- Deletes are per-table and capped so one enormous first run cannot lock the
-- table for minutes. Returns what it did, so a cron run that suddenly deletes
-- its full limit every night is visible in cron.job_run_details.
-- ---------------------------------------------------------------------------
create or replace function purge_raw_cache(p_limit int default 5000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  cap        int := greatest(1, coalesce(p_limit, 5000));
  pages_gone int;
  posts_gone int;
begin
  -- 14 days (0003: 'RETENTION: 14 days').
  with doomed as (
    select ctid from raw_pages
     where fetched_at < now() - interval '14 days'
     order by fetched_at
     limit cap
  )
  delete from raw_pages r using doomed d where r.ctid = d.ctid;
  get diagnostics pages_gone = row_count;

  -- 30 days (0003: 'RETENTION: 30 days'). Social post text.
  with doomed as (
    select ctid from raw_posts
     where fetched_at < now() - interval '30 days'
     order by fetched_at
     limit cap
  )
  delete from raw_posts r using doomed d where r.ctid = d.ctid;
  get diagnostics posts_gone = row_count;

  return jsonb_build_object('raw_pages', pages_gone, 'raw_posts', posts_gone);
end;
$fn$;

comment on function purge_raw_cache(int) is
  'Enforces the raw-cache retention stated in 0003: raw_pages 14 days, raw_posts 30 days.';

-- ---------------------------------------------------------------------------
-- record_daily_metrics() — one snapshot per day, idempotent.
--
-- Every figure here is one the audit script or the home page already computes
-- somewhere; the point is having yesterday's copy of it. `dims` carries the
-- breakdown, which is why the same `key` can appear once overall and once per
-- source without colliding on the unique constraint.
-- ---------------------------------------------------------------------------
create or replace function record_daily_metrics()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  written integer := 0;
  n       integer;
begin
  -- Site-wide counts. `is_agency = false` matches what search shows, and the
  -- agency total is recorded separately rather than folded in — the two were
  -- conflated in site_stats() once already (0032, fixed in 0033).
  insert into metrics (key, value, dims, bucket_at)
  select * from (
    values
      ('open_jobs',
       (select count(*) from jobs where status = 'open' and is_agency = false)::numeric,
       '{}'::jsonb, current_date),
      ('open_jobs_agency',
       (select count(*) from jobs where status = 'open' and is_agency = true)::numeric,
       '{}'::jsonb, current_date),
      ('open_jobs_flagged',
       (select count(*) from jobs
         where status = 'open' and coalesce(array_length(quality_flags, 1), 0) > 0)::numeric,
       '{}'::jsonb, current_date),
      ('companies_active',
       (select count(*) from companies where crawl_status = 'active')::numeric,
       '{}'::jsonb, current_date),
      -- The freshness figure that matters to a job seeker: how old is the
      -- middle of the index, in days.
      ('open_jobs_median_age_days',
       (select coalesce(
                 percentile_cont(0.5) within group (
                   order by extract(epoch from (now() - coalesce(posted_at, first_seen_at))) / 86400.0
                 ), 0)
          from jobs where status = 'open' and is_agency = false)::numeric,
       '{}'::jsonb, current_date),
      ('open_jobs_over_60_days',
       (select count(*) from jobs
         where status = 'open' and is_agency = false
           and coalesce(posted_at, first_seen_at) < now() - interval '60 days')::numeric,
       '{}'::jsonb, current_date),
      ('jobs_closed_today',
       (select count(*) from jobs where closed_at >= current_date)::numeric,
       '{}'::jsonb, current_date),
      ('jobs_added_today',
       (select count(*) from jobs where first_seen_at >= current_date)::numeric,
       '{}'::jsonb, current_date)
  ) as v(key, value, dims, bucket_at)
  on conflict (key, bucket_at, dims) do update set value = excluded.value;
  get diagnostics n = row_count;
  written := written + n;

  -- Per-source open counts. This is the series that shows a scraper dying:
  -- the total barely moves, one source goes flat.
  insert into metrics (key, value, dims, bucket_at)
  select 'open_jobs_by_source',
         count(*)::numeric,
         jsonb_build_object('source', coalesce(source_provider, 'unknown')),
         current_date
    from jobs
   where status = 'open' and is_agency = false
   group by source_provider
  on conflict (key, bucket_at, dims) do update set value = excluded.value;
  get diagnostics n = row_count;
  written := written + n;

  return written;
end;
$fn$;

comment on function record_daily_metrics() is
  'Daily snapshot into metrics: index size, freshness, per-source counts. Idempotent per day.';

-- Service role only. Nothing here should be reachable from a browser.
revoke execute on function purge_raw_cache(int) from anon, authenticated;
revoke execute on function record_daily_metrics() from anon, authenticated;

do $cron$
begin
  create extension if not exists pg_cron;

  -- 02:40 UTC: inside the quiet window, after the dedupe passes at 03:00 would
  -- otherwise be competing for the same pages, and before the 05:17 scrape.
  perform cron.schedule(
    'jobswarm-purge-raw-cache',
    '40 2 * * *',
    $job$select purge_raw_cache(5000)$job$
  );

  -- 23:50 UTC, so the snapshot lands at the end of the day it describes rather
  -- than at the start of the next one.
  perform cron.schedule(
    'jobswarm-daily-metrics',
    '50 23 * * *',
    $job$select record_daily_metrics()$job$
  );

  raise notice 'purge and metrics schedules installed';
exception
  when others then
    raise notice 'pg_cron unavailable (%), skipping schedules.', sqlerrm;
end
$cron$;
