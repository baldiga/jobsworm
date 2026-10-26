-- 0054_revoke_public_execute.sql — close thirteen functions that were open to
-- the internet, including the one that marks a campaign paid.
--
-- ## What was wrong
--
-- Every one of these carries a line like
--
--     revoke execute on function mark_campaign_paid(...) from anon, authenticated;
--
-- and not one of them did anything. Postgres grants EXECUTE on a new function
-- to PUBLIC, and revoking from two roles BY NAME does not remove a grant held
-- by PUBLIC. The ACL kept reading `=X/postgres` — the bare `=` is PUBLIC — and
-- PostgREST's `anon` role inherits it. Because these are SECURITY DEFINER,
-- they then run as the owner, so RLS does not stand in the way either.
--
-- ## What that meant
--
-- Verified against production with nothing but the public anon key:
--
--     POST /rest/v1/rpc/mark_campaign_paid  -> 400 "campaign … not found"
--
-- A 400 on the ID, not a 401 on permission. The function ran. With a real
-- campaign id in the body, an anonymous visitor could mark any listing paid —
-- `activate_campaign` fires on the same path — and take sponsored placement
-- without paying for it. `approve_campaign`, `refund_campaign`,
-- `end_campaign_now` and `reject_campaign` were reachable the same way, as
-- were the maintenance routines: `purge_raw_cache`, `dedupe_open_jobs`,
-- `expire_stale_jobs`, `close_missing_jobs`, `lease_companies`,
-- `record_daily_metrics`, `end_expired_campaigns`.
--
-- ## Found by asserting a property instead of assuming it
--
-- 0053 added a new counter RPC and asserted that anon could not execute it.
-- The assertion failed on the way in, which is the only reason any of this
-- came to light — the revoke wording had looked correct in review since 0010.
--
-- ## The fix
--
-- Revoke from `public` as well as the two named roles, driven off a list so a
-- signature change cannot silently skip one. `service_role` keeps an explicit
-- grant of its own (`service_role=X/postgres`), so every legitimate caller —
-- the webhook, the cron jobs, the importer — is unaffected.

do $revoke$
declare
  fn text;
  sig text;
begin
  foreach fn in array array[
    -- Money and campaign state. These are the serious ones.
    'mark_campaign_paid', 'activate_campaign', 'approve_campaign',
    'reject_campaign', 'refund_campaign', 'end_campaign_now',
    -- Scheduled maintenance. Reachable meant a stranger could make the
    -- database do bulk work on demand.
    'end_expired_campaigns', 'expire_stale_jobs', 'dedupe_open_jobs',
    'purge_raw_cache', 'record_daily_metrics', 'lease_companies',
    'close_missing_jobs',
    -- Counters behind public numbers.
    'bump_apply_click', 'bump_job_view'
  ]
  loop
    for sig in
      select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
    loop
      execute format('revoke execute on function public.%s from public, anon, authenticated', sig);
      raise notice 'revoked public.%', sig;
    end loop;
  end loop;
end
$revoke$;

/*
 * Assert it, for the same reason 0053 did: this class of mistake reads as
 * correct and is invisible until something calls it. If a later migration
 * recreates one of these with `create or replace`, the PUBLIC default comes
 * back and this fails the next deploy rather than the next audit.
 */
do $check$
declare
  leaked text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname in (
       'mark_campaign_paid', 'activate_campaign', 'approve_campaign',
       'reject_campaign', 'refund_campaign', 'end_campaign_now',
       'end_expired_campaigns', 'expire_stale_jobs', 'dedupe_open_jobs',
       'purge_raw_cache', 'record_daily_metrics', 'lease_companies',
       'close_missing_jobs', 'bump_apply_click', 'bump_job_view'
     );

  assert leaked is null, 'still executable by anon: ' || coalesce(leaked, '');

  -- And the legitimate caller must still work, or the cron jobs die tonight.
  assert has_function_privilege('service_role', 'mark_campaign_paid(uuid, text, text, numeric, text)', 'execute'),
    'service_role lost execute on mark_campaign_paid';
  assert has_function_privilege('service_role', 'expire_stale_jobs(integer)', 'execute'),
    'service_role lost execute on expire_stale_jobs';
end
$check$;
