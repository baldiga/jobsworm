-- 0039_ingest_rpcs.sql — make the ingest loop safe to run on a timer.
--
-- Until now the loop has only ever been run by a person, one pass at a time.
-- From this week it runs hourly from Vercel Cron, and two of its steps stop
-- being correct the moment two passes can overlap.
--
-- ## lease_companies — the lease was not a lease
--
-- The TypeScript picks due companies with a SELECT and then marks them leased
-- with a separate UPDATE. Between those two statements another pass can select
-- the same rows. Both then fetch the same ATS feeds and write the same jobs:
-- doubled outbound requests, doubled writes, on an instance that has been
-- taken down by write load before. `for update skip locked` inside one
-- statement is the standard fix and the only one that actually holds.
--
-- ## close_missing_jobs — a round trip per hundred ids
--
-- The old path reads every open row for the company, diffs in JavaScript, and
-- issues chunked UPDATEs. The diff belongs next to the data: one statement,
-- one plan, no id lists travelling over the wire.
--
-- Both are service-role only. Neither is reachable from a browser.

-- ---------------------------------------------------------------------------
-- lease_companies(p_limit, p_lease_minutes)
--
-- Returns the same columns the ingest loop already selects, so the caller is
-- unchanged apart from where the rows come from.
-- ---------------------------------------------------------------------------
create or replace function lease_companies(
  p_limit          int default 40,
  p_lease_minutes  int default 15
)
returns table (
  id           uuid,
  name_en      text,
  domain       text,
  industry     text,
  ats_provider ats_provider,
  ats_token    text,
  fail_count   int
)
language sql
security definer
set search_path = public
as $fn$
  with due as (
    select c.id
      from companies c
     where c.crawl_status = 'active'
       and c.ats_token is not null
       and c.next_run_at <= now()
       and (c.lease_until is null or c.lease_until < now())
     order by c.next_run_at
     limit greatest(1, least(coalesce(p_limit, 40), 200))
     -- The whole point of this function. A row another pass is already
     -- leasing is skipped rather than waited for.
     for update skip locked
  )
  update companies c
     set lease_until = now() + (greatest(1, coalesce(p_lease_minutes, 15)) * interval '1 minute')
    from due
   where c.id = due.id
  returning c.id, c.name_en, c.domain, c.industry, c.ats_provider, c.ats_token, c.fail_count;
$fn$;

comment on function lease_companies(int, int) is
  'Atomically leases up to p_limit due companies for ATS ingestion. See 0039 for why the two-statement version was unsafe.';

-- ---------------------------------------------------------------------------
-- close_missing_jobs(p_company_id, p_provider, p_seen, p_fetched)
--
-- Closes this company's open jobs for this provider whose external id is not
-- in p_seen — the employer has stopped listing them.
--
-- `p_fetched` is the number of rows the ATS feed itself returned, BEFORE the
-- tech and location filters. It is the guard: an empty feed is far more often
-- a silently broken fetch than an employer who closed every role at once, and
-- closing an entire company's listings on a bad afternoon is not a mistake
-- that can be undone from the outside. A feed that returned jobs which were
-- then all filtered out is a different case and does close them, which is the
-- behaviour the JavaScript diff already had.
-- ---------------------------------------------------------------------------
create or replace function close_missing_jobs(
  p_company_id uuid,
  p_provider   text,
  p_seen       text[],
  p_fetched    int default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  affected integer;
begin
  if p_company_id is null or p_provider is null then
    return 0;
  end if;
  if coalesce(p_fetched, 1) = 0 then
    return 0;  -- see the header: an empty feed closes nothing
  end if;

  update jobs j
     set status = 'closed',
         closed_at = now()
   where j.company_id = p_company_id
     and j.source_provider = p_provider
     and j.status = 'open'
     and not (j.source_external_id = any(coalesce(p_seen, '{}'::text[])));

  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

comment on function close_missing_jobs(uuid, text, text[], int) is
  'Closes open jobs the employer no longer lists. Refuses to act on an empty feed.';

revoke execute on function lease_companies(int, int) from anon, authenticated;
revoke execute on function close_missing_jobs(uuid, text, text[], int) from anon, authenticated;
