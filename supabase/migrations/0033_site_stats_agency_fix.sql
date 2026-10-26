-- Put back the two predicates 0032 dropped.
--
-- 0032_site_stats_secrettelaviv.sql only meant to add 'secrettelaviv' to the
-- board list. Rewriting the function whole is the only way to change one CTE,
-- and in the rewrite two filters that 0016/0018/0025 all carried went missing:
--
--   1. open_jobs lost `and is_agency = false`. Every search RPC filters agency
--      rows out, so the home page was claiming a total the site will not show
--      you: 4,296 where search finds 4,242. Worse, the same object reports
--      'agencies' separately, so the 54 agency rows were counted twice over.
--      total + agencies must equal count(*) from open jobs, and it did not.
--
--   2. fb_groups lost `and crawl_status = 'active'`, which would let a paused
--      group keep inflating "groups we read". It changes nothing today — all
--      184 approved groups are active — which is exactly why it is worth
--      restoring now, while the number is still honest by accident.
--
-- Nothing else changes. The wider `select *` and the coalesce()s on newest and
-- companies came in with 0032 deliberately and stay: posted_at is the real
-- posting date, and most rows carry company_name_raw without a company_id.

create or replace function site_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
with open_jobs as (
  select * from jobs where status = 'open' and is_agency = false
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
  where kind = 'facebook_group'
    and review_state = 'approved'
    and crawl_status = 'active'
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
