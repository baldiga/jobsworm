-- A junior should not be shown team-lead roles.
--
-- Reported, and generously:
--
--   "המערכת מאוד מחמיאה לי, והלוואי היה ככה במציאות, אבל אני ג'וניורית,
--    והמשרות שהוא הציע לי זה משרות של ראש צוות, משרות של סניורים וכאלה"
--
--   "The system is very flattering to me, and I wish it were true, but I am a
--    junior, and the jobs it offered me are team-lead roles, senior roles and
--    the like."
--
-- Why it happened. Of the 110 points in `match_jobs_for_me`, skill overlap is
-- 70 and seniority is 8 — and the 8 is a BONUS for agreeing, never a penalty
-- for disagreeing. A junior who knows React, TypeScript and Node therefore
-- scores ~70 on a "Frontend Team Lead" posting, which asks for exactly those
-- three, and nothing anywhere subtracts for the six years of leadership she
-- does not have. Agreement was rewarded; disagreement was free.
--
-- The fix is a distance, not a filter. Adjacent levels are genuinely fuzzy —
-- Israeli titles disagree about where mid ends and senior begins, and a good
-- mid candidate should still see senior postings — so one step costs little.
-- Three steps is not fuzziness, it is a different job.
--
-- `seniority_level` is declared in ascending order in 0002_enums.sql
-- (student, junior, mid, senior, lead, manager, director, exec), so Postgres
-- orders and compares it natively and `array_position(enum_range(...), x)`
-- gives a usable ordinal.
--
-- Reaching UP is what was reported and is penalised hardest. Reaching DOWN is
-- also wrong but much less costly to the reader — a senior shown a mid role
-- has lost a line of screen, not been sent on a hopeless application — so it
-- is a gentler slope.

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
      case
        when p.seniority_levels <> '{}' then p.seniority_levels
        when p.seniority is not null    then array[p.seniority::text]
        else '{}'::text[]
      end as want_seniority,
      case
        when p.job_functions <> '{}' then p.job_functions
        when p.job_function is not null then array[p.job_function]
        else '{}'::text[]
      end as want_function,
      coalesce(p.remote_prefs, '{}') as want_remote
    from profiles p
    where p.user_id = auth.uid()
  ),
  bounds as (
    -- The span the user will accept, as ordinals. Multi-select makes this a
    -- range rather than a point: {mid,senior,manager} tolerates anything from
    -- mid to manager and is only penalised outside it.
    select
      me.*,
      (select min(array_position(enum_range(null::seniority_level), w::seniority_level))
         from unnest(me.want_seniority) w) as want_lo,
      (select max(array_position(enum_range(null::seniority_level), w::seniority_level))
         from unnest(me.want_seniority) w) as want_hi
    from me
  ),
  scored as (
    select
      j.*,
      c.slug as c_slug,
      coalesce(c.name_en, c.name_he, j.company_name_raw) as c_name,
      array(
        select unnest(coalesce(j.skills_required, '{}') || coalesce(j.tech_stack, '{}'))
        intersect
        select unnest(b.skills)
      ) as matched,
      b.skills as my_skills,
      b.titles as my_titles,
      b.regions as my_regions,
      b.want_seniority,
      b.want_function,
      b.want_remote,
      b.want_lo,
      b.want_hi,
      array_position(enum_range(null::seniority_level), j.seniority) as job_level,
      (j.source_provider in (
         'comeet','greenhouse','lever','ashby','workable',
         'smartrecruiters','recruitee','workday','personio','bamboohr'
       )) as ats
    from jobs j
    cross join bounds b
    left join companies c on c.id = j.company_id
    where j.status = 'open'
      and j.is_agency = false
      and (
        (coalesce(j.skills_required, '{}') || coalesce(j.tech_stack, '{}')) && b.skills
        or (b.want_function <> '{}' and j."function"::text = any(b.want_function))
      )
  )
  select
    s.id, s.title_raw, s.c_name, s.c_slug,
    s.location, s.seniority, s.remote, s.employment_type, s.salary,
    s.skills_required, s.tech_stack, s.excerpt, s.source_provider, s.posted_at,
    s.matched,
    least(110, greatest(1, round(
        (cardinality(s.matched)::numeric
         / greatest(1, least(cardinality(s.my_skills), 12))) * 70
      + case when s.want_function <> '{}' and s."function"::text = any(s.want_function)
             then 15 else 0 end
      + coalesce((select max(similarity(s.title_norm, t)) from unnest(s.my_titles) t), 0) * 10
      -- Seniority, +8 to -18.
      --
      -- Inside the wanted range is the old bonus, unchanged. Outside it the
      -- score now falls away with distance, which is the part that was
      -- missing: a junior's skills matching a team-lead posting used to cost
      -- her nothing at all.
      --
      -- A job with no stated seniority is never penalised. Most social posts
      -- do not say, and guessing against the reader would hide real openings.
      + case
          when s.want_seniority = '{}' or s.job_level is null then 0
          when s.job_level between s.want_lo and s.want_hi then 8
          when s.job_level > s.want_hi then
            case s.job_level - s.want_hi
              when 1 then -2      -- mid asked, senior offered: fair enough
              when 2 then -9
              else -18            -- junior asked, lead or above offered
            end
          else
            case s.want_lo - s.job_level
              when 1 then -1
              when 2 then -4
              else -8             -- senior asked, student role offered
            end
        end
      + case when s.my_regions is not null and array_length(s.my_regions, 1) > 0
                  and (s.location ->> 'region') = any(s.my_regions)
             then 5 else 0 end
      + case
          when s.want_remote = '{}' then 0
          when s.remote::text = any(s.want_remote) then 5
          when s.remote is null or s.remote::text = 'unknown' then 0
          else -6
        end
      + case when s.ats then 7 else 0 end
      + (5.0 / (1.0 + (extract(epoch from (now() - coalesce(s.posted_at, s.first_seen_at))) / 86400.0)))
      - (coalesce(s.ghost_score, 0)::numeric / 100.0) * 10
    )))::int as score,
    s.ats as direct_from_employer
  from scored s
  order by score desc, coalesce(s.posted_at, s.first_seen_at) desc
  limit greatest(1, least(coalesce(p_limit, 40), 100))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;

comment on function match_jobs_for_me(int, int) is
  'CV matches scored 1-110. Seniority, field and work setup are multi-select; each scores if ANY '
  'chosen value matches. Seniority is a distance, +8 inside the wanted range and down to -18 for a '
  'role three or more levels above it, so a junior stops being shown team-lead postings. Function '
  'is a ranking signal, not a filter.';
