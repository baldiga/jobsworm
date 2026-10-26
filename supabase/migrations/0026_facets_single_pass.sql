-- Stop running the search predicate four times to draw four filter menus.
--
-- Measured on production after 0025, ten samples per query:
--
--     search_jobs         median 0.9-1.6s
--     search_jobs_count   median 0.5-1.4s
--     search_facets       median 2.6s, and the query that failed most often
--
-- `search_facets` was the slowest thing on the page, and the reason is visible
-- in 0017: it calls `search_facet_rows` FOUR times, once per dimension, each
-- with that dimension's own filter removed. Removing the filter is correct — a
-- region count has to say what you WOULD get if you changed region, not what
-- you have now — but it was being paid for unconditionally.
--
-- The observation that makes it cheap: when a dimension is not filtered,
-- "the set with that filter removed" IS the set with all filters applied. On a
-- normal page load nothing is filtered, so all four passes computed the same
-- rows, four times over. One pass now serves every dimension, and a second pass
-- is run only for a dimension the visitor has actually filtered on — and by
-- then the base set is small, because it is filtered.
--
--     no filters        4 passes -> 1
--     one filter        4 passes -> 2
--     all four filters  4 passes -> 5, over a set small enough not to matter
--
-- Counts stay exact. Nothing here samples or caps.
--
-- Note on why this matters more than it looks: the phrase queries are the
-- expensive ones. A search for "backend developer" is widened to four quoted
-- phrases, and a GIN index cannot verify word adjacency from the index alone,
-- so every candidate row's tsvector is re-read and re-checked. Paying that four
-- times is what pushed the page over the 3-second anon statement timeout.

create or replace function search_facets(
  q         text default null,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  f              jsonb := coalesce(p_filters, '{}'::jsonb);
  out_regions    jsonb;
  out_functions  jsonb;
  out_seniority  jsonb;
  out_remote     jsonb;
begin
  -- The one pass. Every dimension is aggregated from the same scan.
  with rows as materialized (
    select * from search_facet_rows(q, f)
  )
  select
    (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
       from (select region as k, count(*) as n from rows group by 1) s),
    (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
       from (select fn as k, count(*) as n from rows group by 1) s),
    (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
       from (select seniority as k, count(*) as n from rows group by 1) s),
    (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
       from (select remote as k, count(*) as n from rows group by 1) s)
    into out_regions, out_functions, out_seniority, out_remote;

  -- And only now, per dimension the visitor is actually filtering on, the
  -- extra pass that answers "what would I get if I changed this one".
  if f ? 'regions' then
    select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into out_regions
      from (select region as k, count(*) as n
              from search_facet_rows(q, f - 'regions') group by 1) s;
  end if;

  if f ? 'functions' then
    select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into out_functions
      from (select fn as k, count(*) as n
              from search_facet_rows(q, f - 'functions') group by 1) s;
  end if;

  if f ? 'seniority' then
    select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into out_seniority
      from (select seniority as k, count(*) as n
              from search_facet_rows(q, f - 'seniority') group by 1) s;
  end if;

  if f ? 'remote' then
    select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into out_remote
      from (select remote as k, count(*) as n
              from search_facet_rows(q, f - 'remote') group by 1) s;
  end if;

  return jsonb_build_object(
    'regions',   out_regions,
    'functions', out_functions,
    'seniority', out_seniority,
    'remote',    out_remote
  );
end;
$fn$;

grant execute on function search_facets(text, jsonb) to anon, authenticated;

comment on function search_facets(text, jsonb) is
  'Filter-menu counts. One scan serves every unfiltered dimension; a dimension the visitor has filtered gets its own pass so its count still says what changing it would give.';
