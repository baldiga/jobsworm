-- 0043_cv_gaps.sql — what to add to your CV.
--
-- ## The question the match page could never answer
--
-- A person looks at thirty matches and sees thirty scores. What they actually
-- want to know is the thing none of those scores says: **what is the one skill
-- that would change the most of these?**
--
-- 0042 made that computable. `why -> 'missing_required'` is, per match, what
-- the job asks for that the reader does not have. Counted across their top
-- matches it becomes a ranked answer, drawn from the jobs they are actually
-- competing for rather than from a general "hot skills" list.
--
-- ## It is a description, not advice
--
-- The wording on the page matters as much as the query: *if you have it, add
-- it; if not, this is what those jobs want.* Half the hits will be skills the
-- person has and did not write down, which is a ten-second fix and the most
-- valuable thing this feature does. Telling somebody to go and learn Kafka is
-- not something a job board is entitled to do.
--
-- ## Scoped to the reader, like everything else
--
-- `match_jobs_for` is revoked from browsers and takes a user id; this wrapper
-- passes `auth.uid()` and is the only way in.

create or replace function cv_gaps_for_me(p_top int default 30, p_limit int default 12)
returns table (
  skill text,
  jobs_wanting int,
  example_title text,
  example_company text,
  example_job_id uuid
)
language sql
stable
security definer
set search_path = public
as $fn$
  with top_matches as (
    select id, title_raw, company_name, why
      from match_jobs_for(auth.uid(), greatest(1, least(coalesce(p_top, 30), 100)), 0)
  ),
  gaps as (
    select
      lower(s.skill) as skill,
      m.title_raw,
      m.company_name,
      m.id,
      -- Highest-scoring match first, because that is the most persuasive
      -- example to show beside the count.
      row_number() over (partition by lower(s.skill) order by m.title_raw) as rn
    from top_matches m
    cross join lateral jsonb_array_elements_text(
      coalesce(m.why -> 'missing_required', '[]'::jsonb)
    ) as s(skill)
    where s.skill is not null and s.skill <> ''
  )
  /*
   * `array_agg(... order by rn)[1]` rather than `max(case when rn = 1 ...)`.
   *
   * The CASE trick needs an aggregate over the column's type, and Postgres has
   * no `max(uuid)` — the first push of this migration failed on exactly that.
   * Taking the first element of an ordered aggregate works for any type and
   * says what it means: the example from the best-ranked match.
   */
  select
    g.skill,
    count(*)::int as jobs_wanting,
    (array_agg(g.title_raw   order by g.rn))[1] as example_title,
    (array_agg(g.company_name order by g.rn))[1] as example_company,
    (array_agg(g.id          order by g.rn))[1] as example_job_id
  from gaps g
  group by g.skill
  -- One job asking for something is not a gap, it is a job. Two is a pattern.
  having count(*) >= 2
  order by count(*) desc, g.skill
  limit greatest(1, least(coalesce(p_limit, 12), 30));
$fn$;

grant execute on function cv_gaps_for_me(int, int) to authenticated;

comment on function cv_gaps_for_me(int, int) is
  'Required skills missing from the profile, counted across the reader''s own top matches. A '
  'description of what those jobs ask for, not advice about what to learn.';
