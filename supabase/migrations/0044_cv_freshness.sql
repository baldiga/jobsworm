-- 0044_cv_freshness.sql — keep the 90-day promise.
--
-- ## The promise, and the fact
--
-- `lib/consent.ts` says it in both languages, and it is what people agreed to:
--
--   "CVs stop being used for matching after 90 days."
--   "וקורות חיים מפסיקים לשמש להתאמות אחרי 90 יום."
--
-- `profiles.cv_fresh_until` is written by the CV route on every upload, ninety
-- days out. Nothing has ever read it. Matching has been running on CVs of any
-- age since the day the column was added, so the promise is currently a
-- sentence rather than a behaviour.
--
-- ## What "stops being used" means here
--
-- Matching returns nothing once the window has passed AND the profile has not
-- been touched since. Both halves matter:
--
--   - A person who has been editing their skills every week has a profile that
--     is current by any reasonable reading, and cutting them off on the
--     anniversary of an upload would be pedantry rather than privacy.
--   - A person who uploaded once and never came back is exactly who the
--     promise was made to.
--
-- The CV itself is not deleted. Deletion is what `delete_my_account` is for,
-- and quietly destroying somebody's data because they went on holiday would be
-- its own kind of surprise. What stops is the USE.
--
-- ## Confirming
--
-- `confirm_cv_current()` extends the window by another ninety days. It is one
-- button, it belongs to the person, and it is the whole reason this is a
-- freshness rule and not an expiry.

create or replace function cv_is_fresh(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select
       p.cv_fresh_until is null           -- never uploaded a CV: nothing to expire
       or p.cv_fresh_until > now()        -- inside the window
       or p.updated_at > p.cv_parsed_at   -- edited since, so it is being kept current
     from profiles p
     where p.user_id = p_user),
    true
  );
$fn$;

revoke execute on function cv_is_fresh(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- match_jobs_for_me — same signature, same scoring, one new guard.
--
-- The guard sits in the WRAPPER rather than in `match_jobs_for`, deliberately:
-- the eval harness and `cv_gaps_for_me` call the inner function, and an eval
-- that silently returned nothing because a synthetic profile looked stale
-- would be a maddening thing to debug.
-- ---------------------------------------------------------------------------
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
  select * from match_jobs_for(auth.uid(), p_limit, p_offset)
   where cv_is_fresh(auth.uid());
$fn$;

grant execute on function match_jobs_for_me(int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_cv_current — "yes, this is still me".
-- ---------------------------------------------------------------------------
create or replace function confirm_cv_current()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_until timestamptz;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;

  v_until := now() + interval '90 days';
  update profiles
     set cv_fresh_until = v_until
   where user_id = auth.uid();

  return v_until;
end;
$fn$;

grant execute on function confirm_cv_current() to authenticated;

-- ---------------------------------------------------------------------------
-- cv_freshness_for_me — what the banner needs, without exposing the column.
--
-- `days_left` goes negative once the window has passed, so one number carries
-- both "warn them soon" and "it has stopped".
-- ---------------------------------------------------------------------------
create or replace function cv_freshness_for_me()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select case when p.user_id is null then null else jsonb_build_object(
    'fresh_until', p.cv_fresh_until,
    'parsed_at', p.cv_parsed_at,
    'reviewed_at', p.cv_reviewed_at,
    'days_left', case
                   when p.cv_fresh_until is null then null
                   else floor(extract(epoch from (p.cv_fresh_until - now())) / 86400.0)::int
                 end,
    'is_fresh', cv_is_fresh(p.user_id)
  ) end
  from (select * from profiles where user_id = auth.uid()) p;
$fn$;

grant execute on function cv_freshness_for_me() to authenticated;
