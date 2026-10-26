-- Live counters for the home page.
--
-- Replaces 0016's site_stats with a version that also returns the three numbers
-- the hero states as evidence: applications made, job seekers signed up, and
-- the per-category source breakdown behind the "everywhere recruiters post,
-- in one place" claim.
--
-- Every one of these is counted, never asserted. A landing page that claims
-- "70 Facebook groups" while the crawler is actually reading 68 is the kind of
-- small lie that costs the whole page its credibility, so the page renders
-- whatever this returns.
--
-- Source categories map the `sources.kind` column and the job `source_provider`
-- onto the four things a visitor actually cares about:
--   ats      -- applicant tracking systems the employer pays for
--   board    -- Israeli job listing sites
--   social   -- Facebook groups and LinkedIn posts
-- Counts come from the sources registry where one exists (Facebook groups are
-- registered and approved individually) and from distinct providers actually
-- present in the open index otherwise.

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
),
ats_providers as (
  select count(distinct source_provider)::bigint as n
  from open_jobs
  where source_provider in (
    'comeet','greenhouse','lever','ashby','workable','smartrecruiters',
    'recruitee','workday','personio','bamboohr'
  )
),
board_providers as (
  select count(distinct source_provider)::bigint as n
  from open_jobs
  where source_provider in ('drushim','alljobs','yad2','jobmaster','shushu')
),
fb_groups as (
  -- Approved, actively crawled public groups. Falls back to 0 rather than
  -- guessing if the registry has not been populated.
  select count(*)::bigint as n
  from sources
  where kind = 'facebook_group'
    and review_state = 'approved'
    and crawl_status = 'active'
)
select jsonb_build_object(
  'total',     (select count(*)::bigint from open_jobs),
  'companies', (select count(distinct company_id)::bigint
                from open_jobs where company_id is not null),
  'newest',    (select max(first_seen_at) from open_jobs),
  'agencies',  (select count(*)::bigint from jobs
                where status = 'open' and is_agency = true),
  -- Times someone clicked through to an employer's own application page.
  'applications', (select count(*)::bigint from events where name = 'apply_click'),
  -- Registered job seekers. profiles is our own row per signed-up user.
  'seekers',      (select count(*)::bigint from profiles),
  'ats_count',    (select n from ats_providers),
  'board_count',  (select n from board_providers),
  'fb_groups',    (select n from fb_groups),
  'sources',   coalesce(
                 (select jsonb_agg(jsonb_build_object('provider', provider, 'n', n))
                  from by_source),
                 '[]'::jsonb)
);
$fn$;

grant execute on function site_stats() to anon, authenticated;

comment on function site_stats() is
  'Public counters for the home page: open jobs, applications, seekers, freshness, and the source breakdown. All counted from live data; nothing on the page is hardcoded.';
