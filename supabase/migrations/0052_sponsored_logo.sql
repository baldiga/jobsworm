-- 0052_sponsored_logo.sql — sponsored cards carry the employer's logo.
--
-- 0051 added `jobs.company_logo_path`; this is the one read path that needs
-- it today, because sponsored cards are what a paying recruiter is buying and
-- the logo is most of what they mean by "our listing".
--
-- Adding a column to the OUT row type is a drop-and-recreate, not a replace.
-- The body below is 0050's verbatim, with one column added in two places —
-- copied rather than retyped, because a transcription slip in the ordering
-- clause would silently undo FIFO.

drop function if exists sponsored_jobs(text, jsonb, int);

create or replace function sponsored_jobs(
  q         text default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit   int default 3
)
returns table (
  id uuid, company_id uuid, title_raw text, title_norm text,
  "function" job_function, sub_function text, seniority seniority_level,
  employment_type employment_type, remote remote_mode, hybrid_days_office int,
  location jsonb, skills_required text[], skills_nice text[], tech_stack text[],
  languages jsonb, education education_level, clearance boolean, salary jsonb,
  salary_estimate jsonb, excerpt text, apply_url text, apply_method apply_method,
  source_provider text, source_url text, lang job_lang, is_agency boolean,
  company_hidden boolean, quality_flags text[], posted_at timestamptz,
  first_seen_at timestamptz, last_seen_at timestamptz, ghost_score int,
  status job_status, company_name text, company_slug text, company_domain text,
  rank real, sponsored_campaign_id uuid, sponsored_price_usd numeric,
  sponsored_days int, sponsored_until timestamptz, sponsored_kind text,
  company_logo_path text
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
    case when normalize_he(q) is null then null
         else websearch_to_tsquery('simple', normalize_he(q)) end as query
),
live as (
  select j.id,
    (case when t.query is null then 0::real
          when j.search_tsv @@ t.query then ts_rank_cd(j.search_tsv, t.query)
          else 0::real end)::real as rank
  from jobs j
  cross join tsq t
  where j.status = 'open'
    and j.sponsored_until is not null
    and j.sponsored_until > now()
    -- No is_agency predicate here, on purpose: this is the one surface where
    -- an agency listing may appear, and it appears labelled as one.
    and (
      t.query is null
      or (j.search_tsv @@ t.query
          and ts_rank_cd(array[0, 0, 0.4, 1.0], j.search_tsv, t.query) > 0)
      or (position(' or ' in t.norm_q) = 0
          and length(t.norm_q) <= 24
          and coalesce(j.title_norm, '') % t.norm_q)
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
  c.slug, c.domain, l.rank,
  j.sponsored_campaign_id, j.sponsored_price_usd, j.sponsored_days,
  j.sponsored_until, cp.kind, j.company_logo_path
from live l
join jobs j on j.id = l.id
left join companies c on c.id = j.company_id
left join campaigns cp on cp.id = j.sponsored_campaign_id
-- Relevance, then who bought first. `j.id` last so the order is total: two
-- campaigns activated in the same statement share a `starts_at` to the
-- microsecond, and without a final key those two rows could still swap.
order by l.rank desc, cp.starts_at asc nulls last, j.id
limit greatest(1, least(coalesce(p_limit, 3), 6));
$fn$;

grant execute on function sponsored_jobs(text, jsonb, int) to anon, authenticated;

do $check$
declare
  a uuid[];
  b uuid[];
begin
  -- Called twice, it must return the same rows in the same order. Under
  -- `random()` this assertion fails as soon as two campaigns tie on rank,
  -- which is exactly the case it is here to protect.
  select array_agg(id order by ord) into a
    from (select id, row_number() over () as ord from sponsored_jobs(null, '{}'::jsonb, 6)) s;
  select array_agg(id order by ord) into b
    from (select id, row_number() over () as ord from sponsored_jobs(null, '{}'::jsonb, 6)) s;
  assert a is not distinct from b, 'sponsored_jobs is not stable between calls';
end
$check$;
