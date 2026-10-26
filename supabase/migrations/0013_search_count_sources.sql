-- The `sources` filter was added to search_jobs in 0012 but not to its count
-- companion, so a filtered search reported the unfiltered total and paginated
-- into empty pages.

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
       or j.company_id = (t.f ->> 'company_id')::uuid)
  and (t.f -> 'sources' is null
       or j.source_provider in (
            select jsonb_array_elements_text(t.f -> 'sources')));
$fn$;

grant execute on function search_jobs_count(text, jsonb) to anon, authenticated;
