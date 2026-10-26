-- 0008_functions.sql — Hebrew normalization, expiry, and the search entry point.
-- PLAN.md sections 5.3 (Hebrew normalization) and 6 (search).

-- ---------------------------------------------------------------------------
-- normalize_he: the canonical text normalizer. The TypeScript twin lives in
-- packages/core/src/normalize.ts and MUST stay behaviourally identical.
--   1. strip niqqud and cantillation (U+0591..U+05C7)
--   2. unify final letters so search matches regardless of word position
--   3. collapse whitespace, trim, lowercase Latin
-- ---------------------------------------------------------------------------
create or replace function normalize_he(input text)
returns text
language sql
immutable
parallel safe
as $fn$
  select nullif(
    btrim(
      regexp_replace(
        lower(
          translate(
            regexp_replace(coalesce(input, ''), '[֑-ׇ]', '', 'g'),
            'ךםןףץ',
            'כמנפצ'
          )
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$fn$;

comment on function normalize_he(text) is
  'Hebrew-aware normalizer: strips niqqud, unifies final letters, collapses whitespace, lowercases Latin. Mirrored by normalizeHe() in packages/core.';

-- ---------------------------------------------------------------------------
-- expire_stale_jobs: nightly closer for link-out sources whose expires_at has
-- passed (PLAN.md 4.4 — Yad2/AllJobs 14 days, social 21 days).
-- ---------------------------------------------------------------------------
create or replace function expire_stale_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  affected integer;
begin
  update jobs
     set status = 'closed',
         closed_at = now()
   where status = 'open'
     and expires_at is not null
     and expires_at < now();
  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- search_jobs: the single search entry point (PLAN.md section 6).
--
-- MVP ranking is FTS-only: websearch_to_tsquery over the weighted search_tsv,
-- with a trigram fallback on title_norm when the tsquery matches nothing.
--
-- >>> The vector leg of the RRF hybrid plugs in HERE once embeddings are
-- >>> backfilled (session F8). Today every jobs.embedding is NULL, so joining
-- >>> it would rank worse than not joining it at all. When F8 lands, add a
-- >>> second CTE selecting the top 100 by `embedding <=> $query_embedding`
-- >>> and combine with the FTS leg using reciprocal rank fusion (k = 60).
--
-- Filters arrive as jsonb so the signature stays stable as filters are added.
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
)
select
  j.id, j.company_id, j.title_raw, j.title_norm, j."function", j.sub_function,
  j.seniority, j.employment_type, j.remote, j.hybrid_days_office, j.location,
  j.skills_required, j.skills_nice, j.tech_stack, j.languages, j.education,
  j.clearance, j.salary, j.salary_estimate, j.excerpt, j.apply_url,
  j.apply_method, j.source_provider, j.source_url, j.lang, j.is_agency,
  j.company_hidden, j.quality_flags, j.posted_at, j.first_seen_at,
  j.last_seen_at, j.ghost_score, j.status,
  coalesce(c.name_en, c.name_he) as company_name,
  c.slug as company_slug,
  c.domain as company_domain,
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
  )::real as rank
from jobs j
cross join tsq t
left join companies c on c.id = j.company_id
where j.status = 'open'
  -- agency postings are hidden from the main index unless explicitly asked for
  and j.is_agency = coalesce((t.f ->> 'is_agency')::boolean, false)
  and (
    t.query is null
    or j.search_tsv @@ t.query
    or similarity(coalesce(j.title_norm, ''), t.norm_q) > 0.3
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
order by rank desc, coalesce(j.posted_at, j.first_seen_at) desc
limit greatest(1, least(coalesce(p_limit, 50), 100))
offset greatest(0, coalesce(p_offset, 0));
$fn$;

comment on function search_jobs(text, jsonb, int, int) is
  'Job search. FTS + trigram fallback today; the vector RRF leg lands with F8 embeddings (see the comment block in the body).';

-- Companion count for pagination. Mirrors the WHERE clause above.
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
    or j.search_tsv @@ t.query
    or similarity(coalesce(j.title_norm, ''), t.norm_q) > 0.3
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
       or j.company_id = (t.f ->> 'company_id')::uuid);
$fn$;

-- ---------------------------------------------------------------------------
-- Facet counts for the filter bar. Each facet drops its own filter so the
-- counts show what WOULD match if the user picked that value.
-- ---------------------------------------------------------------------------
create or replace function search_facets(
  q         text default null,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'regions', (
      select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
      from (select coalesce(location ->> 'region', 'unknown') as k, count(*) as n
              from search_jobs(q, coalesce(p_filters, '{}'::jsonb) - 'regions', 100, 0)
             group by 1) s),
    'functions', (
      select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
      from (select coalesce("function"::text, 'unknown') as k, count(*) as n
              from search_jobs(q, coalesce(p_filters, '{}'::jsonb) - 'functions', 100, 0)
             group by 1) s),
    'seniority', (
      select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
      from (select coalesce(seniority::text, 'unknown') as k, count(*) as n
              from search_jobs(q, coalesce(p_filters, '{}'::jsonb) - 'seniority', 100, 0)
             group by 1) s),
    'remote', (
      select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
      from (select remote::text as k, count(*) as n
              from search_jobs(q, coalesce(p_filters, '{}'::jsonb) - 'remote', 100, 0)
             group by 1) s)
  );
$fn$;

grant execute on function normalize_he(text) to anon, authenticated;
grant execute on function search_jobs(text, jsonb, int, int) to anon, authenticated;
grant execute on function search_jobs_count(text, jsonb) to anon, authenticated;
grant execute on function search_facets(text, jsonb) to anon, authenticated;
