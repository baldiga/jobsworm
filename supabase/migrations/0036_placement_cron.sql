-- 0036_placement_cron.sql — end campaigns on time.
--
-- Every 15 minutes, not nightly. A buyer paid for a number of days; a listing
-- that stays up half a day past the end is free advertising we did not agree
-- to give, and one that stays up while the buyer believes it has ended is
-- worse — they may have hired, and applications are still arriving.
--
-- Fifteen minutes is also short enough that "it ended when it said it would"
-- is true from the buyer's point of view, and long enough that the check costs
-- nothing: `campaigns_ends_at_idx` is a partial index over live campaigns
-- only, so the usual run finds nothing and stops.
--
-- Guarded exactly as 0009 and 0037 are: pg_cron is unavailable on local
-- `supabase start`, and a `db reset` must stay green there.

do $cron$
begin
  create extension if not exists pg_cron;

  perform cron.schedule(
    'jobswarm-end-campaigns',
    '*/15 * * * *',
    $job$select end_expired_campaigns(200)$job$
  );

  raise notice 'campaign expiry schedule installed';
exception
  when others then
    raise notice 'pg_cron unavailable (%), skipping schedule. Campaigns will end only when end_expired_campaigns() is called.', sqlerrm;
end
$cron$;
