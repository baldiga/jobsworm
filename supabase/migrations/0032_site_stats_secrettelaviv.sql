-- Count Secret Tel Aviv among the Israeli job boards on the home page.
--
-- `board_providers` in 0025_search_narrow_sort.sql is a hard-coded list, so a
-- new board is invisible to the counter until it is named. With AllJobs and
-- Drushim withheld the count had fallen to 1 (drushimavodot); this makes it 2,
-- which is the honest figure rather than a flattering one.
--
-- Only this one CTE changes. The rest of `site_stats` is reproduced verbatim
-- from 0025 because the function has to be replaced whole.

create or replace function site_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
with open_jobs as (
  select * from jobs where status = 'open'
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
  -- Israeli job listing sites. drushimavodot arrives as a partner feed and
  -- secrettelaviv as an RSS feed rather than a scrape, but to a reader they
  -- are the same thing: another Israeli board whose listings are in here.
  select count(distinct source_provider)::bigint as n
  from open_jobs
  where source_provider in (
    'drushim','alljobs','drushimavodot','yad2','jobmaster','shushu','secrettelaviv'
  )
),
fb_groups as (
  select count(*)::bigint as n
  from sources
  where kind = 'facebook_group' and review_state = 'approved'
),
li_posts as (
  select count(*)::bigint as n
  from open_jobs
  where source_provider = 'linkedin'
)
select jsonb_build_object(
  'total',        (select count(*)::bigint from open_jobs),
  'newest',       (select max(coalesce(posted_at, first_seen_at)) from open_jobs),
  'companies',    (select count(distinct coalesce(company_id::text, company_name_raw))
                from open_jobs
                where company_id is not null or company_name_raw is not null),
  'agencies',     (select count(*)::bigint from jobs
                where status = 'open' and is_agency = true),
  'applications', (select count(*)::bigint from events where name = 'apply_click'),
  'seekers',      (select count(*)::bigint from profiles),
  'ats_count',    (select n from ats_providers),
  'board_count',  (select n from board_providers),
  'fb_groups',    (select n from fb_groups),
  'li_posts',     (select n from li_posts),
  'sources',   coalesce(
                 (select jsonb_agg(jsonb_build_object('provider', provider, 'n', n))
                  from by_source),
                 '[]'::jsonb)
);
$fn$;

grant execute on function site_stats() to anon, authenticated;
