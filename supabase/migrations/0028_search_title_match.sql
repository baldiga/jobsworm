-- A search for "marketing" must not return "Head of R&D".
--
-- Reported: searching Marketing, filtered to executive and the last three days,
-- returned four jobs and not one of them was a marketing job --
--
--     rank 0.508  Chief Development Officer- Enlight Local
--     rank 0.507  Member Of Technical Staff, CTO Office
--     rank 0.449  Field CTO
--     rank 0.448  CTO Office Team Member
--
-- Every one matched only because the word "marketing" appears somewhere in its
-- description. Genuine title matches for the same query score 2.6 to 5.2, so
-- ranking was never the problem: these should not have been in the result SET
-- at all. With a narrow filter they were all that was left, so they filled the
-- page.
--
-- `search_tsv` has been weighted since 0003 -- A for the title, B for skills
-- and stack, D for the description -- and ts_rank_cd already leans on that. But
-- the WHERE clause asked only `search_tsv @@ query`, which is true for a match
-- anywhere, description included.
--
-- It now also requires the match to touch the title or the skills:
--
--     ts_rank_cd(array[0, 0, 0.4, 1.0], search_tsv, query) > 0
--
-- The array is {D, C, B, A}. Zeroing D means a description-only match scores
-- exactly zero and is excluded, while a title or skills match is unaffected.
-- The `@@` test stays alongside it so the GIN index still does the narrowing
-- and this only filters the candidates it returns.
--
-- MEASURED BEFORE CHANGING ANYTHING, over the top 100 results for each of
-- devops, marketing, qa, product manager and data analyst:
--
--     title or skills   489 of 500
--     description only   11 of 500
--
-- So this drops about 2% of results, and that 2% is the tail. The worry was
-- social posts, where the body carries the detail and the title is derived from
-- the first line -- but they split 130 title/skills against 5 description-only,
-- because socialTitle already recovers the role. They are not the casualty.
--
-- A query with no strong match now returns nothing rather than four wrong
-- things, which is the honest answer to "marketing executive, last three days".
--
-- The three function bodies are otherwise exactly what 0024 and 0025
-- installed; only the predicate differs.

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
      or (
           j.search_tsv @@ t.query
           -- and the match must touch the title (A) or the skills (B)
           and ts_rank_cd(array[0, 0, 0.4, 1.0], j.search_tsv, t.query) > 0
         )
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

create or replace function search_jobs_count(
  q         text default null,
  p_filters jsonb default '{}'::jsonb
)
returns bigint
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
)
select count(*)
from jobs j
cross join tsq t
where j.status = 'open'
  and j.is_agency = coalesce((t.f ->> 'is_agency')::boolean, false)
  and (
    t.query is null
    or (
         j.search_tsv @@ t.query
         -- and the match must touch the title (A) or the skills (B)
         and ts_rank_cd(array[0, 0, 0.4, 1.0], j.search_tsv, t.query) > 0
       )
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
            select jsonb_array_elements_text(t.f -> 'sources')));
$fn$;

create or replace function search_facet_rows(
  q         text default null,
  p_filters jsonb default '{}'::jsonb
)
returns table (region text, fn text, seniority text, remote text)
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
)
select
  coalesce(j.location ->> 'region', 'unknown'),
  coalesce(j."function"::text, 'unknown'),
  coalesce(j.seniority::text, 'unknown'),
  coalesce(j.remote::text, 'unknown')
from jobs j
cross join tsq t
where j.status = 'open'
  and j.is_agency = coalesce((t.f ->> 'is_agency')::boolean, false)
  and (
    t.query is null
    or (
         j.search_tsv @@ t.query
         -- and the match must touch the title (A) or the skills (B)
         and ts_rank_cd(array[0, 0, 0.4, 1.0], j.search_tsv, t.query) > 0
       )
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
            select jsonb_array_elements_text(t.f -> 'sources')));
$fn$;

grant execute on function search_jobs(text, jsonb, int, int) to anon, authenticated;
grant execute on function search_jobs_count(text, jsonb) to anon, authenticated;
grant execute on function search_facet_rows(text, jsonb) to anon, authenticated;
