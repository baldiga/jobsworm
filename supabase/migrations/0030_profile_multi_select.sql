-- Seniority, field and work setup become multi-select, like regions already is.
--
-- Reported, with the reasoning stated better than a spec would have:
--
--   "enable multi selections, for example seniority, I may want to choose
--    Mid-Level, Senior and Manager, same should be enabled in 'your field' and
--    'work setup'; this is already done in 'Regions'."
--
-- That is exactly right, and the inconsistency was arbitrary: `profiles.regions`
-- has been `text[]` since 0004_people.sql while the three next to it were
-- single-valued, so the profile editor could offer chips for one and radio
-- behaviour for the others on the same screen.
--
-- It also matters for matching, not just for the form. Somebody two years in is
-- a plausible fit for mid AND junior postings, and Israeli titles are not
-- consistent about which they use; forcing one choice throws away half the
-- candidates. The same goes for someone open to hybrid or remote but not
-- onsite, who currently has to pretend to want exactly one.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- `remote_pref` was added an hour ago in 0029 to replace `hybrid_tolerance`,
-- and is superseded before it ever shipped: the fix and the request arrived in
-- the same batch of reports. It is empty and nothing deployed reads it, so it
-- goes rather than lingering as a second dead column beside hybrid_tolerance.
alter table profiles drop column if exists remote_pref;

-- text[], to match `regions`, rather than the enum arrays used elsewhere in
-- this table. The API validates against the same sets the UI renders from, and
-- a text array keeps the RPC free of enum casts on every comparison.
alter table profiles
  add column if not exists seniority_levels text[] not null default '{}',
  add column if not exists job_functions    text[] not null default '{}',
  add column if not exists remote_prefs     text[] not null default '{}';

comment on column profiles.seniority_levels is
  'Acceptable seniority levels, e.g. {mid,senior,lead}. Empty means no preference. '
  'Falls back to the single `seniority` column when empty.';
comment on column profiles.job_functions is
  'Fields of interest, e.g. {software_engineering,devops}. Empty means no preference. '
  'Falls back to the single `job_function` column, which the CV parser sets.';
comment on column profiles.remote_prefs is
  'Acceptable work setups, any of onsite | hybrid | remote. Empty means no preference.';

-- Seed the arrays from the single columns so nobody loses a preference they
-- already set. `regions` needs nothing: it was always an array.
update profiles
   set seniority_levels = array[seniority::text]
 where seniority is not null
   and seniority_levels = '{}';

update profiles
   set job_functions = array[job_function]
 where job_function is not null
   and job_functions = '{}';

-- ---------------------------------------------------------------------------
-- Matching reads the arrays
-- ---------------------------------------------------------------------------
--
-- The return type is unchanged from 0019, so this is a plain replace.
--
-- Both preferences keep a fallback to their single column. The CV parser writes
-- `job_function` on every upload and nothing writes `job_functions` until the
-- user edits their profile, so without the fallback a fresh CV would score as
-- though the field were unknown.

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
      -- The array wins when the user has set one; otherwise the single column
      -- stands in, so an untouched profile behaves exactly as it did.
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
      me.want_remote,
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
        or (me.want_function <> '{}' and j."function"::text = any(me.want_function))
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
      -- Same field, 0-15. Any of the chosen fields counts.
      + case when s.want_function <> '{}' and s."function"::text = any(s.want_function)
             then 15 else 0 end
      -- Title affinity, 0-10.
      + coalesce((select max(similarity(s.title_norm, t)) from unnest(s.my_titles) t), 0) * 10
      -- Seniority agreement, 0-8. Any of the chosen levels counts, which is the
      -- point of the change: a mid/senior/lead selection now scores all three
      -- instead of forcing one and under-ranking the other two.
      + case when s.want_seniority <> '{}' and s.seniority::text = any(s.want_seniority)
             then 8 else 0 end
      -- Region preference, 0-5.
      + case when s.my_regions is not null and array_length(s.my_regions, 1) > 0
                  and (s.location ->> 'region') = any(s.my_regions)
             then 5 else 0 end
      -- Work setup, 0-5 and -6. New, and the first thing `remote_prefs` is for:
      -- somebody who will not commute should not be shown onsite roles at the
      -- same rank as remote ones. Unknown is never penalised — most social
      -- posts do not say.
      + case
          when s.want_remote = '{}' then 0
          when s.remote::text = any(s.want_remote) then 5
          when s.remote is null or s.remote::text = 'unknown' then 0
          else -6
        end
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

comment on function match_jobs_for_me(int, int) is
  'CV matches scored 1-110. 100+ means skills, field, seniority, region and a direct-to-employer '
  'application all line up. Seniority, field and work setup are multi-select; each scores if ANY '
  'chosen value matches. Function is a ranking signal, not a filter.';
