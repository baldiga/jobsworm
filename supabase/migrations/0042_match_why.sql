-- 0042_match_why.sql — say why, and say why not.
--
-- ## The problem with a single number
--
-- `match_jobs_for_me` returns a score out of 110 and a list of matched skills.
-- A reader seeing "87" has no way to tell whether that means "you have every
-- skill but it is two levels above you" or "you have three of eight skills and
-- everything else lines up". Those call for opposite decisions, and the card
-- cannot tell them apart.
--
-- It is also how the seniority complaint stayed invisible for so long. The
-- distance penalty landed in 0031, and it is right — but a junior looking at a
-- team-lead posting scored 62 instead of 78 and saw no reason for either
-- figure. The penalty was applied and never explained.
--
-- So the RPC now returns `why`: the components of its own arithmetic, as
-- jsonb. Nothing about the score changes. What changes is that the card can
-- say one true sentence about the gap.
--
-- ## Two functions, and only one of them is reachable
--
-- `match_jobs_for(p_user, …)` does the work. `match_jobs_for_me()` is a thin
-- wrapper that passes `auth.uid()`.
--
-- The split exists so evals and the CV-gap query can run the same matcher for
-- a named user — but it means a function with a user id argument now exists,
-- and a SECURITY DEFINER function taking a user id that `authenticated` may
-- call is a function any signed-in person can point at anybody else's profile.
-- So it is revoked from anon and authenticated, and only the wrapper is
-- granted. The browser can ask about itself and has no way to ask about
-- anybody else.

drop function if exists match_jobs_for_me(int, int);

create or replace function match_jobs_for(
  p_user   uuid,
  p_limit  int default 40,
  p_offset int default 0
)
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
  skills_nice text[],
  tech_stack text[],
  excerpt text,
  source_provider text,
  posted_at timestamptz,
  req_years_min int,
  req_years_max int,
  education education_level,
  matched_skills text[],
  score int,
  direct_from_employer boolean,
  why jsonb
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
      p.years_experience,
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
    where p.user_id = p_user
  ),
  bounds as (
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
      -- New: what the job asks for and the reader does NOT have. This is the
      -- half of the comparison that was never computed, and it is the half a
      -- person can act on.
      array(
        select unnest(coalesce(j.skills_required, '{}'))
        except
        select unnest(b.skills)
      ) as missing_required,
      array(
        select unnest(coalesce(j.skills_nice, '{}'))
        intersect
        select unnest(b.skills)
      ) as matched_nice,
      b.skills as my_skills,
      b.titles as my_titles,
      b.regions as my_regions,
      b.years_experience as my_years,
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
    s.skills_required, s.skills_nice, s.tech_stack, s.excerpt, s.source_provider,
    s.posted_at, s.req_years_min, s.req_years_max, s.education,
    s.matched,
    least(110, greatest(1, round(
        (cardinality(s.matched)::numeric
         / greatest(1, least(cardinality(s.my_skills), 12))) * 70
      + case when s.want_function <> '{}' and s."function"::text = any(s.want_function)
             then 15 else 0 end
      + coalesce((select max(similarity(s.title_norm, t)) from unnest(s.my_titles) t), 0) * 10
      + case
          when s.want_seniority = '{}' or s.job_level is null then 0
          when s.job_level between s.want_lo and s.want_hi then 8
          when s.job_level > s.want_hi then
            case s.job_level - s.want_hi
              when 1 then -2
              when 2 then -9
              else -18
            end
          else
            case s.want_lo - s.job_level
              when 1 then -1
              when 2 then -4
              else -8
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
    s.ats as direct_from_employer,
    /*
     * The same facts the arithmetic above used, as data rather than as a
     * number. Deliberately NOT a sentence: the wording belongs in TypeScript
     * where it can be read, tested and translated, and a migration is a poor
     * place to keep copy.
     *
     * `delta` on seniority is signed and in levels — positive means the job is
     * above what the reader asked for, which is the direction that was
     * reported and the one worth naming first.
     */
    jsonb_build_object(
      'matched_required', array(
        select unnest(coalesce(s.skills_required, '{}'))
        intersect
        select unnest(s.my_skills)
      ),
      'matched_nice', s.matched_nice,
      'missing_required', s.missing_required,
      'seniority', jsonb_build_object(
        'job', s.seniority,
        'want_lo', case when s.want_lo is null then null
                   else (enum_range(null::seniority_level))[s.want_lo]::text end,
        'want_hi', case when s.want_hi is null then null
                   else (enum_range(null::seniority_level))[s.want_hi]::text end,
        'delta', case
                   when s.want_seniority = '{}' or s.job_level is null then null
                   when s.job_level > s.want_hi then s.job_level - s.want_hi
                   when s.job_level < s.want_lo then s.job_level - s.want_lo
                   else 0
                 end
      ),
      'years', jsonb_build_object(
        'req_min', s.req_years_min,
        'req_max', s.req_years_max,
        'mine', s.my_years
      ),
      'region', jsonb_build_object(
        'job', s.location ->> 'region',
        'ok', (s.my_regions is null
               or array_length(s.my_regions, 1) is null
               or (s.location ->> 'region') = any(s.my_regions))
      ),
      'remote', jsonb_build_object(
        'job', s.remote::text,
        'ok', (s.want_remote = '{}'
               or s.remote is null
               or s.remote::text = 'unknown'
               or s.remote::text = any(s.want_remote))
      ),
      'function', jsonb_build_object(
        'job', s."function"::text,
        'ok', (s.want_function = '{}' or s."function"::text = any(s.want_function))
      )
    ) as why
  from scored s
  order by score desc, coalesce(s.posted_at, s.first_seen_at) desc
  limit greatest(1, least(coalesce(p_limit, 40), 100))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;

/*
 * REVOKED. A SECURITY DEFINER function taking a user id, callable by any
 * signed-in person, is a function any signed-in person can point at anybody
 * else's profile and matches. Only the wrapper below is reachable.
 */
revoke execute on function match_jobs_for(uuid, int, int) from anon, authenticated;

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
  skills_nice text[],
  tech_stack text[],
  excerpt text,
  source_provider text,
  posted_at timestamptz,
  req_years_min int,
  req_years_max int,
  education education_level,
  matched_skills text[],
  score int,
  direct_from_employer boolean,
  why jsonb
)
language sql
stable
security definer
set search_path = public
as $fn$
  select * from match_jobs_for(auth.uid(), p_limit, p_offset);
$fn$;

grant execute on function match_jobs_for_me(int, int) to authenticated;

comment on function match_jobs_for_me(int, int) is
  'CV matches scored 1-110, with `why` carrying the components of that score so the card can name '
  'the single biggest gap instead of showing a bare number. Scoring is unchanged from 0031.';
