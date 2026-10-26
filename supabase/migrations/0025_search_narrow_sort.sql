-- Make search cheap enough that a busy database cannot take it down.
--
-- On 2026-09-09 search on jobswarm.fun returned "canceling statement due to
-- statement timeout" to real visitors. The trigger was a bulk import competing
-- for CPU, and the import has been paced so it cannot do that again. But the
-- import only revealed the problem; it did not create it. A search that needs
-- the whole instance to itself is one busy afternoon away from failing again.
--
-- WHAT WAS ACTUALLY EXPENSIVE
--
-- Not the scan. `jobs` is about 7,400 open rows in a 19 MB heap, fully cached:
-- 2,416 shared buffer hits and no disk reads at all. Postgres reads that in
-- milliseconds.
--
-- The SORT was expensive. The old function is shaped
--
--     select <34 columns> from jobs j left join companies c ...
--     where <filters> order by rank desc, posted_at desc limit 24
--
-- and `rank` is computed, so nothing can supply the order from an index. Every
-- matching row therefore goes into a sort node -- and it goes in WHOLE. Text
-- arrays, four jsonb columns, the excerpt: roughly 2.6 KB per row, and about
-- 19 MB for an unfiltered query. This instance has a few megabytes of work_mem,
-- so that is an external merge sort writing temp files to disk, on every single
-- search, in order to return twenty-four rows.
--
-- THE FIX
--
-- Sort narrow, then widen. The inner query carries only what the ORDER BY
-- needs -- id, rank, date -- which is about 40 bytes a row, so ~300 KB sorts
-- comfortably in memory. The wide columns and the companies join are then
-- fetched by primary key for the twenty-four rows that survived.
--
-- Same rows, same order, same output columns. Only the shape changes.
--
-- Two other things are fixed while here:
--
--   * `expire_stale_jobs()` closed every expired row in one UPDATE. At 340 rows
--     that already exceeded the statement timeout, so the nightly closer had
--     silently stopped closing anything and expired postings stayed visible.
--     It now takes a batch size and returns what it closed, so a caller loops.
--   * `site_stats()` counts Drushim-Avodot among the job boards, and reports
--     LinkedIn separately, for the coverage line on the home page.

-- ---------------------------------------------------------------------------
-- search_jobs: sort narrow, then widen
-- ---------------------------------------------------------------------------
create or replace function search_jobs(
  q         text default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit   int default 50,
  p_offset  int default 0
)
returns table (
  id uuid,
  company_id uuid,
  title_raw text,
  title_norm text,
  "function" job_function,
  sub_function text,
  seniority seniority_level,
  employment_type employment_type,
  remote remote_mode,
  hybrid_days_office int,
  location jsonb,
  skills_required text[],
  skills_nice text[],
  tech_stack text[],
  languages jsonb,
  education education_level,
  clearance boolean,
  salary jsonb,
  salary_estimate jsonb,
  excerpt text,
  apply_url text,
  apply_method apply_method,
  source_provider text,
  source_url text,
  lang job_lang,
  is_agency boolean,
  company_hidden boolean,
  quality_flags text[],
  posted_at timestamptz,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  ghost_score int,
  status job_status,
  company_name text,
  company_slug text,
  company_domain text,
  rank real
)
language sql
stable
security definer
set search_path = public
as $fn$
with tsq as (
  select
    normalize_he(q) as norm_q,
    coalesce(p_filters, '{}'::jsonb) as f,
    case
      when normalize_he(q) is null then null
      else websearch_to_tsquery('simple', normalize_he(q))
    end as query
),
-- The sort happens HERE, on three narrow columns. No arrays, no jsonb, no
-- excerpt, and no join to companies: none of it affects the order, and all of
-- it was being dragged through the sort node.
ranked as (
  select
    j.id,
    (
      case
        when t.query is null then 0::real
        when j.search_tsv @@ t.query then ts_rank_cd(j.search_tsv, t.query)
        else similarity(coalesce(j.title_norm, ''), t.norm_q) * 0.3
      end
      -- freshness nudge: newer postings float up within the same relevance band
      + (1.0 / (1.0 + (extract(epoch from (now() - coalesce(j.posted_at, j.first_seen_at))) / 86400.0)))::real * 0.15
      -- ghost penalty (PLAN.md 5.5): stale-looking postings sink
      - (coalesce(j.ghost_score, 0)::real / 100.0) * 0.2
    )::real as rank,
    coalesce(j.posted_at, j.first_seen_at) as sort_date
  from jobs j
  cross join tsq t
  where j.status = 'open'
    -- agency postings are hidden from the main index unless explicitly asked for
    and j.is_agency = coalesce((t.f ->> 'is_agency')::boolean, false)
    and (
      t.query is null
      or j.search_tsv @@ t.query
      or (
           -- Fuzzy title match, but only for a real single short term, and via
           -- the `%` operator so the trigram index is actually used.
           position(' or ' in t.norm_q) = 0
           and length(t.norm_q) <= 24
           and coalesce(j.title_norm, '') % t.norm_q
         )
    )
    and (t.f -> 'regions' is null
         or coalesce(j.location ->> 'region', '') in (
              select jsonb_array_elements_text(t.f -> 'regions')))
    and (t.f -> 'functions' is null
         or j."function"::text in (
              select jsonb_array_elements_text(t.f -> 'functions')))
    and (t.f -> 'seniority' is null
         or j.seniority::text in (
              select jsonb_array_elements_text(t.f -> 'seniority')))
    and (t.f -> 'remote' is null
         or j.remote::text in (
              select jsonb_array_elements_text(t.f -> 'remote')))
    and (t.f -> 'employment_types' is null
         or j.employment_type::text in (
              select jsonb_array_elements_text(t.f -> 'employment_types')))
    and (t.f -> 'skills' is null
         or j.skills_required && (
              select array_agg(lower(x)) from jsonb_array_elements_text(t.f -> 'skills') x)
         or j.tech_stack && (
              select array_agg(lower(x)) from jsonb_array_elements_text(t.f -> 'skills') x))
    and (coalesce((t.f ->> 'has_salary')::boolean, false) = false
         or j.salary is not null)
    and (t.f ->> 'posted_within_days' is null
         or coalesce(j.posted_at, j.first_seen_at)
            >= now() - ((t.f ->> 'posted_within_days')::int * interval '1 day'))
    and (t.f ->> 'company_id' is null
         or j.company_id = (t.f ->> 'company_id')::uuid)
    and (t.f -> 'sources' is null
         or j.source_provider in (
              select jsonb_array_elements_text(t.f -> 'sources')))
  order by rank desc, sort_date desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0))
)
-- Only now, for one page worth of rows, is anything wide read.
select
  j.id, j.company_id, j.title_raw, j.title_norm, j."function", j.sub_function,
  j.seniority, j.employment_type, j.remote, j.hybrid_days_office, j.location,
  j.skills_required, j.skills_nice, j.tech_stack, j.languages, j.education,
  j.clearance, j.salary, j.salary_estimate, j.excerpt, j.apply_url,
  j.apply_method, j.source_provider, j.source_url, j.lang, j.is_agency,
  j.company_hidden, j.quality_flags, j.posted_at, j.first_seen_at,
  j.last_seen_at, j.ghost_score, j.status,
  coalesce(c.name_en, c.name_he, j.company_name_raw) as company_name,
  c.slug as company_slug,
  c.domain as company_domain,
  r.rank
from ranked r
join jobs j on j.id = r.id
left join companies c on c.id = j.company_id
order by r.rank desc, r.sort_date desc;
$fn$;

grant execute on function search_jobs(text, jsonb, int, int) to anon, authenticated;

comment on function search_jobs(text, jsonb, int, int) is
  'Ranked job search. Sorts on id/rank/date only, then joins the wide columns for the returned page; sorting whole rows was an on-disk merge sort on every request.';

-- ---------------------------------------------------------------------------
-- expire_stale_jobs: batched, so it can finish
-- ---------------------------------------------------------------------------
--
-- The nightly closer had quietly stopped working. One UPDATE over every expired
-- row exceeded the statement timeout, so it rolled back and closed nothing, and
-- expired postings kept showing up in search. A closer that fails silently is
-- worse than no closer, because the no-ghost-jobs promise on the home page
-- depends on it.
--
-- A batch size makes each call bounded. The caller loops until it returns 0.
create or replace function expire_stale_jobs(p_limit int default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  affected integer;
begin
  with due as (
    select id from jobs
     where status = 'open'
       and expires_at is not null
       and expires_at < now()
     limit greatest(1, least(coalesce(p_limit, 500), 5000))
  )
  update jobs j
     set status = 'closed',
         closed_at = now()
    from due
   where j.id = due.id;
  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

comment on function expire_stale_jobs(int) is
  'Closes expired postings in bounded batches. Call in a loop until it returns 0.';

-- ---------------------------------------------------------------------------
-- site_stats: Drushim-Avodot is a job board, and LinkedIn gets its own count
-- ---------------------------------------------------------------------------
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
  -- Israeli job listing sites. drushimavodot arrives as a partner feed rather
  -- than a scrape, but to a reader it is the same thing: another Israeli board
  -- whose listings are in here.
  select count(distinct source_provider)::bigint as n
  from open_jobs
  where source_provider in ('drushim','alljobs','drushimavodot','yad2','jobmaster','shushu')
),
fb_groups as (
  select count(*)::bigint as n
  from sources
  where kind = 'facebook_group'
    and review_state = 'approved'
    and crawl_status = 'active'
),
li_posts as (
  -- LinkedIn hiring posts currently in the index. Counted, not asserted: this
  -- is the number the home page prints, so it is the number that is true.
  select count(*)::bigint as n from open_jobs where source_provider = 'linkedin'
)
select jsonb_build_object(
  'total',     (select count(*)::bigint from open_jobs),
  'companies', (select count(distinct company_id)::bigint
                from open_jobs where company_id is not null),
  'newest',    (select max(first_seen_at) from open_jobs),
  'agencies',  (select count(*)::bigint from jobs
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
