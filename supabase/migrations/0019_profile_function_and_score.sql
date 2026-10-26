-- CV function on the profile, and a 1-110 match score.
--
-- Two problems with the old matching:
--
-- 1. It compared skills and nothing else, so a marketing CV whose only
--    recognised terms were "sql" and "python" matched backend jobs. The CV now
--    carries a FUNCTION, classified by the same code that classifies a job, so
--    like is compared with like.
--
-- 2. `score` was an unbounded real with no meaning. A user cannot read "1.87".
--    The score is now 1-110 on a stated scale: 100+ means everything lined up,
--    and the components are fixed weights so two jobs are comparable.
--
-- The function is a RANKING signal, never a filter. The classifier gets mixed
-- CVs wrong -- a RevOps CV reads as operations about as often as marketing --
-- and PLAN.md 13 is explicit that a parser the user can correct beats a
-- confident black box. So the user can edit it, and a job outside their
-- function still appears if the skills genuinely overlap.

alter table profiles
  add column if not exists job_function text,
  add column if not exists function_confidence real;

comment on column profiles.job_function is
  'Function classified from the CV, same enum as jobs.function. User-editable; a ranking signal, never a filter.';

-- `create or replace` cannot change a function's return type, and this one gains
-- `direct_from_employer` and narrows `score` from real to int, so the old
-- signature has to go first.
drop function if exists match_jobs_for_me(int, int);

create or replace function match_jobs_for_me(p_limit int default 40, p_offset int default 0)
returns table (
  id uuid,
  title_raw text,
  company_name text,
  company_slug text,
  location jsonb,
  seniority seniority_level,
  remote remote_mode,
  employment_type employment_type,
  salary jsonb,
  skills_required text[],
  tech_stack text[],
  excerpt text,
  source_provider text,
  posted_at timestamptz,
  matched_skills text[],
  score int,
  direct_from_employer boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  with me as (
    select
      coalesce(p.skills, '{}') as skills,
      coalesce(p.preferred_titles, '{}') as titles,
      p.regions,
      p.seniority as want_seniority,
      p.job_function as want_function
    from profiles p
    where p.user_id = auth.uid()
  ),
  scored as (
    select
      j.*,
      c.slug as c_slug,
      coalesce(c.name_en, c.name_he, j.company_name_raw) as c_name,
      array(
        select unnest(coalesce(j.skills_required, '{}') || coalesce(j.tech_stack, '{}'))
        intersect
        select unnest(me.skills)
      ) as matched,
      me.skills as my_skills,
      me.titles as my_titles,
      me.regions as my_regions,
      me.want_seniority,
      me.want_function,
      -- Applying on the employer's own system beats a job-board relay: fewer
      -- redirects, no re-keying, and the posting is first-hand.
      (j.source_provider in (
         'comeet','greenhouse','lever','ashby','workable',
         'smartrecruiters','recruitee','workday','personio','bamboohr'
       )) as ats
    from jobs j
    cross join me
    left join companies c on c.id = j.company_id
    where j.status = 'open'
      and j.is_agency = false
      -- Appear when the skills genuinely overlap OR the function matches.
      -- Requiring a shared skill alone hid every job in the user's own field
      -- that happened to list tools they had not named.
      and (
        (coalesce(j.skills_required, '{}') || coalesce(j.tech_stack, '{}')) && me.skills
        or (me.want_function is not null and j."function"::text = me.want_function)
      )
  )
  select
    s.id, s.title_raw, s.c_name, s.c_slug,
    s.location, s.seniority, s.remote, s.employment_type, s.salary,
    s.skills_required, s.tech_stack, s.excerpt, s.source_provider, s.posted_at,
    s.matched,
    least(110, greatest(1, round(
      -- Skill overlap, 0-70. Normalised against the user's own list so a job
      -- listing thirty skills cannot outrank a focused one on volume alone.
        (cardinality(s.matched)::numeric
         / greatest(1, least(cardinality(s.my_skills), 12))) * 70
      -- Same field, 0-15.
      + case when s.want_function is not null and s."function"::text = s.want_function
             then 15 else 0 end
      -- Title affinity, 0-10.
      + coalesce((select max(similarity(s.title_norm, t)) from unnest(s.my_titles) t), 0) * 10
      -- Seniority agreement, 0-8.
      + case when s.want_seniority is not null and s.seniority = s.want_seniority
             then 8 else 0 end
      -- Region preference, 0-5.
      + case when s.my_regions is not null and array_length(s.my_regions, 1) > 0
                  and (s.location ->> 'region') = any(s.my_regions)
             then 5 else 0 end
      -- Apply directly to the employer, 0-7.
      + case when s.ats then 7 else 0 end
      -- Freshness, 0-5, and the ghost penalty search already applies.
      + (5.0 / (1.0 + (extract(epoch from (now() - coalesce(s.posted_at, s.first_seen_at))) / 86400.0)))
      - (coalesce(s.ghost_score, 0)::numeric / 100.0) * 10
    )))::int as score,
    s.ats as direct_from_employer
  from scored s
  order by score desc, coalesce(s.posted_at, s.first_seen_at) desc
  limit greatest(1, least(coalesce(p_limit, 40), 100))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;

grant execute on function match_jobs_for_me(int, int) to authenticated;

comment on function match_jobs_for_me(int, int) is
  'CV matches scored 1-110. 100+ means skills, function, seniority, region and a direct-to-employer application all line up. Function is a ranking signal, not a filter.';
