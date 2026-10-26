-- 0040_search_fields.sql — four filters that answer questions people actually
-- ask, and the column they need to do it.
--
-- ## Numbering
--
-- The revised plan reserved 0040-0042 for the CV work and 0043 for this. The
-- CV work has not shipped, and applying 0043 before 0040 exists would leave a
-- gap that the Supabase CLI later refuses to fill — it tracks applied versions
-- and rejects an out-of-order apply. So this takes the next free number and
-- the CV migrations follow it. Nothing depends on the reserved numbers.
--
-- ## What is new
--
-- `search_jobs` now returns `req_years_min` and `req_years_max`, which
-- decomposition has been writing since 0003 and no search path has ever
-- returned. They are what the card's "3+ yrs" chip reads and what makes the
-- first two filters below possible.
--
-- Four predicates, added to all three search functions so the results, the
-- count and the facet counts cannot disagree:
--
--   junior_friendly   req_years_min <= 1, OR unstated on a junior/student row
--   years_max         req_years_min is null or <= N
--   no_degree         education says no degree is required
--   hebrew_optional   Hebrew is not a stated requirement
--
-- ## Why "unstated" counts as junior-friendly
--
-- Roughly a third of postings never state a year figure. Treating those as
-- "unknown, therefore excluded" would hide most of the junior market behind a
-- filter whose whole purpose is to find it — and a posting titled "Junior
-- Backend Developer" with no years in the body is not ambiguous to a reader.
-- So an unstated requirement qualifies when the seniority says junior or
-- student, and does not otherwise.
--
-- ## Deliberately NOT done
--
-- `skills_nice` is not added to the tsvector. That column is a generated
-- tsvector behind a GIN index, and rebuilding a generated column over the whole
-- table is the exact change that took the site down on 2026-09-09. Nice-to-have
-- skills stay reachable through `tech_stack`, which is already in the vector;
-- weighting them differently from required ones belongs to matching, not
-- search.
--
-- Every function below is dropped and recreated because the RETURNS TABLE
-- signature changes (0019:30 pattern), which means the grants must be re-issued.

-- ---------------------------------------------------------------------------
-- The shared predicate, written once as a comment and pasted into all three
-- functions verbatim. Keeping them identical is what keeps a result set, its
-- count and its facet counts consistent.
--
--   and (t.f ->> 'years_max' is null
--        or j.req_years_min is null
--        or j.req_years_min <= (t.f ->> 'years_max')::int)
--   and (coalesce((t.f ->> 'junior_friendly')::boolean, false) = false
--        or coalesce(j.req_years_min, 99) <= 1
--        or (j.req_years_min is null and j.seniority in ('junior','student')))
--   and (coalesce((t.f ->> 'no_degree')::boolean, false) = false
--        or j.education is null or j.education in ('none','bsc_advantage'))
--   and (coalesce((t.f ->> 'hebrew_optional')::boolean, false) = false
--        or j.languages is null
--        or coalesce(j.languages ->> 'hebrew', '') not in ('required','native'))
-- ---------------------------------------------------------------------------

drop function if exists search_jobs(text, jsonb, int, int);

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
  req_years_min int,
  req_years_max int,
  total_comp jsonb,
  benefits text[],
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
ranked as (
  select
    j.id,
    (
      case
        when t.query is null then 0::real
        when j.search_tsv @@ t.query then ts_rank_cd(j.search_tsv, t.query)
        else similarity(coalesce(j.title_norm, ''), t.norm_q) * 0.3
      end
      + (1.0 / (1.0 + (extract(epoch from (now() - coalesce(j.posted_at, j.first_seen_at))) / 86400.0)))::real * 0.15
      - (coalesce(j.ghost_score, 0)::real / 100.0) * 0.2
    )::real as rank,
    coalesce(j.posted_at, j.first_seen_at) as sort_date
  from jobs j
  cross join tsq t
  where j.status = 'open'
    and j.is_agency = coalesce((t.f ->> 'is_agency')::boolean, false)
    and (
      t.query is null
      or (
           j.search_tsv @@ t.query
           and ts_rank_cd(array[0, 0, 0.4, 1.0], j.search_tsv, t.query) > 0
         )
      or (
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
    -- new in 0040
    and (t.f ->> 'years_max' is null
         or j.req_years_min is null
         or j.req_years_min <= (t.f ->> 'years_max')::int)
    and (coalesce((t.f ->> 'junior_friendly')::boolean, false) = false
         or coalesce(j.req_years_min, 99) <= 1
         or (j.req_years_min is null and j.seniority in ('junior','student')))
    and (coalesce((t.f ->> 'no_degree')::boolean, false) = false
         or j.education is null or j.education in ('none','bsc_advantage'))
    and (coalesce((t.f ->> 'hebrew_optional')::boolean, false) = false
         or j.languages is null
         or coalesce(j.languages ->> 'hebrew', '') not in ('required','native'))
  order by rank desc, sort_date desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0))
)
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
  j.req_years_min,
  j.req_years_max,
  j.total_comp,
  j.benefits,
  r.rank
from ranked r
join jobs j on j.id = r.id
left join companies c on c.id = j.company_id
order by r.rank desc, r.sort_date desc;
$fn$;

grant execute on function search_jobs(text, jsonb, int, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The count. Same predicate, or the number under the search box lies.
-- ---------------------------------------------------------------------------
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
         and ts_rank_cd(array[0, 0, 0.4, 1.0], j.search_tsv, t.query) > 0
       )
    or (
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
  and (t.f ->> 'years_max' is null
       or j.req_years_min is null
       or j.req_years_min <= (t.f ->> 'years_max')::int)
  and (coalesce((t.f ->> 'junior_friendly')::boolean, false) = false
       or coalesce(j.req_years_min, 99) <= 1
       or (j.req_years_min is null and j.seniority in ('junior','student')))
  and (coalesce((t.f ->> 'no_degree')::boolean, false) = false
       or j.education is null or j.education in ('none','bsc_advantage'))
  and (coalesce((t.f ->> 'hebrew_optional')::boolean, false) = false
       or j.languages is null
       or coalesce(j.languages ->> 'hebrew', '') not in ('required','native'));
$fn$;

grant execute on function search_jobs_count(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The facet source. Same predicate again, so a chip's count matches what
-- clicking it returns.
-- ---------------------------------------------------------------------------
/*
 * The column is `fn`, not `"function"`.
 *
 * Naming it `"function"` here changed the OUT row type, and `create or
 * replace` cannot do that — the first push of this migration failed on
 * exactly that, and rolled back. More to the point, `search_facets` (0026)
 * selects `fn` from this function, so the rename would have broken every
 * facet count on the page even if Postgres had allowed it.
 *
 * Keeping the established name means no drop, no re-grant, and nothing
 * downstream to update.
 */
create or replace function search_facet_rows(
  q         text default null,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  region text,
  fn text,
  seniority text,
  remote text
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
)
select
  coalesce(j.location ->> 'region', 'unknown'),
  coalesce(j."function"::text, 'unknown'),
  coalesce(j.seniority::text, 'unknown'),
  j.remote::text
from jobs j
cross join tsq t
where j.status = 'open'
  and j.is_agency = coalesce((t.f ->> 'is_agency')::boolean, false)
  and (
    t.query is null
    or (
         j.search_tsv @@ t.query
         and ts_rank_cd(array[0, 0, 0.4, 1.0], j.search_tsv, t.query) > 0
       )
    or (
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
  and (t.f ->> 'years_max' is null
       or j.req_years_min is null
       or j.req_years_min <= (t.f ->> 'years_max')::int)
  and (coalesce((t.f ->> 'junior_friendly')::boolean, false) = false
       or coalesce(j.req_years_min, 99) <= 1
       or (j.req_years_min is null and j.seniority in ('junior','student')))
  and (coalesce((t.f ->> 'no_degree')::boolean, false) = false
       or j.education is null or j.education in ('none','bsc_advantage'))
  and (coalesce((t.f ->> 'hebrew_optional')::boolean, false) = false
       or j.languages is null
       or coalesce(j.languages ->> 'hebrew', '') not in ('required','native'));
$fn$;

grant execute on function search_facet_rows(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Supporting index.
--
-- `junior_friendly` and `years_max` both key on `req_years_min` over open
-- rows, which is a small fraction of the table. Partial, so it stays small.
-- ---------------------------------------------------------------------------
create index if not exists jobs_req_years_open_idx
  on jobs (req_years_min)
  where status = 'open' and is_agency = false;
