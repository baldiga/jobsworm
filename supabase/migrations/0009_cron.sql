-- 0009_cron.sql — scheduled DB-side jobs (PLAN.md section 2).
--
-- pg_cron is unavailable on local `supabase start` and on some hosted tiers,
-- so the whole block is guarded: where the extension cannot be created the
-- migration logs a notice and succeeds, keeping `db reset` green everywhere.
--
-- The keep-alive matters on the Supabase free tier: a project with no activity
-- for 7 days is paused, and a paused project means a dead site.

do $cron$
begin
  create extension if not exists pg_cron;

  -- Keep-alive so a free-tier project is never idle long enough to pause.
  perform cron.schedule(
    'jobswarm-keepalive',
    '0 */6 * * *',
    $job$select 1$job$
  );

  -- Close link-out and social postings past their expiry (PLAN.md 4.3, 4.4).
  perform cron.schedule(
    'jobswarm-expire-jobs',
    '15 2 * * *',
    $job$select expire_stale_jobs()$job$
  );

  raise notice 'pg_cron schedules installed';
exception
  when others then
    raise notice 'pg_cron unavailable (%), skipping schedules. Vercel Cron still drives ingestion.', sqlerrm;
end
$cron$;
