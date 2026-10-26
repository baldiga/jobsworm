-- Scraped postings carry their employer as free text, not a companies row, so
-- the joined name is null for every AllJobs and Facebook job. Without this the
-- cards render with a blank employer. Also adds a `sources` filter so the UI can
-- separate ATS-sourced jobs from the supplementary boards.

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
  coalesce(c.name_en, c.name_he, j.company_name_raw) as company_name,
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
  and (t.f -> 'sources' is null
       or j.source_provider in (
            select jsonb_array_elements_text(t.f -> 'sources')))
order by rank desc, coalesce(j.posted_at, j.first_seen_at) desc
limit greatest(1, least(coalesce(p_limit, 50), 100))
offset greatest(0, coalesce(p_offset, 0));
$fn$;

comment on function search_jobs(text, jsonb, int, int) is
  'Job search. FTS + trigram fallback; company name falls back to company_name_raw for scraped sources. The vector RRF leg lands with F8 embeddings.';

grant execute on function search_jobs(text, jsonb, int, int) to anon, authenticated;
