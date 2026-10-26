-- Landing page stats.
--
-- The landing page states a live job count, a source breakdown and a freshness
-- timestamp. Those are the claims that make an aggregator credible, so none of
-- them may be hardcoded — a stale number on a freshness claim is worse than no
-- number at all.
--
-- PostgREST cannot express a group-by, so the source breakdown needs an RPC.
--
-- Counts match what the default search actually returns: open jobs with
-- is_agency = false. Showing a headline total that includes rows the user can
-- never see in results would be a lie by omission.
--
-- Freshness comes from the newest job's first_seen_at rather than the `runs`
-- table. `runs` went silently unwritten for a long stretch because both writers
-- used column names that did not exist, so it is not trustworthy as the public
-- freshness signal. The newest job is derived from the data itself and cannot
-- drift from reality.

create or replace function site_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
with open_jobs as (
  select j.source_provider, j.company_id, j.first_seen_at
  from jobs j
  where j.status = 'open'
    and j.is_agency = false
),
by_source as (
  select source_provider as provider, count(*)::bigint as n
  from open_jobs
  group by source_provider
  order by count(*) desc
)
select jsonb_build_object(
  'total',     (select count(*)::bigint from open_jobs),
  'companies', (select count(distinct company_id)::bigint
                from open_jobs where company_id is not null),
  'newest',    (select max(first_seen_at) from open_jobs),
  -- Open jobs the agency gate removed from the index. The landing page states
  -- this number as evidence, so it is counted rather than asserted.
  'agencies',  (select count(*)::bigint from jobs
                where status = 'open' and is_agency = true),
  'sources',   coalesce(
                 (select jsonb_agg(jsonb_build_object('provider', provider, 'n', n))
                  from by_source),
                 '[]'::jsonb)
);
$fn$;

grant execute on function site_stats() to anon, authenticated;

comment on function site_stats() is
  'Public counts for the landing page: total open non-agency jobs, distinct companies, per-source breakdown and newest first_seen_at. Matches the default search result set.';
