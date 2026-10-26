-- Facet counts were computed over a 100-row window, not the whole result set.
--
-- search_facets called `search_jobs(q, filters, 100, 0)` and grouped the rows
-- it got back. With 5,000+ open jobs that meant a facet read "North 1" when
-- North actually had hundreds — clicking it then returned far more than the
-- number promised, which makes every count on the page look like a lie.
--
-- Fixing it by raising the limit would only move the threshold. Instead the
-- predicate is factored into one set-returning helper that yields just the
-- four facet columns, unlimited, and the facets aggregate over that. The
-- helper is the same WHERE clause as search_jobs_count, kept adjacent to it so
-- the two cannot drift.
--
-- Each facet still removes its OWN key from the filter object before counting,
-- so selecting "North" continues to show how many jobs the other regions would
-- return rather than collapsing them all to zero.

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

grant execute on function search_facet_rows(text, jsonb) to anon, authenticated;

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
      from (select region as k, count(*) as n
              from search_facet_rows(q, coalesce(p_filters, '{}'::jsonb) - 'regions')
             group by 1) s),
    'functions', (
      select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
      from (select fn as k, count(*) as n
              from search_facet_rows(q, coalesce(p_filters, '{}'::jsonb) - 'functions')
             group by 1) s),
    'seniority', (
      select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
      from (select seniority as k, count(*) as n
              from search_facet_rows(q, coalesce(p_filters, '{}'::jsonb) - 'seniority')
             group by 1) s),
    'remote', (
      select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
      from (select remote as k, count(*) as n
              from search_facet_rows(q, coalesce(p_filters, '{}'::jsonb) - 'remote')
             group by 1) s)
  );
$fn$;

grant execute on function search_facets(text, jsonb) to anon, authenticated;

comment on function search_facets(text, jsonb) is
  'Facet counts over the FULL filtered result set. Counting a limited window made every facet under-report; see search_facet_rows.';
