-- 0010_app_rpcs.sql — the RPCs the web app calls.
-- PLAN.md section 7 (seeker product) and section 8 (profile and consent).

-- ---------------------------------------------------------------------------
-- bump_apply_click: engagement counters for the ghost meter (PLAN.md 5.5).
-- Service-role only, called from the events sink. Deliberately stores nothing
-- that links a click to a person.
-- ---------------------------------------------------------------------------
create or replace function bump_apply_click(p_job_id uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update jobs
     set apply_clicks_7d  = apply_clicks_7d + 1,
         apply_clicks_30d = apply_clicks_30d + 1
   where id = p_job_id;
$fn$;

revoke execute on function bump_apply_click(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- toggle_saved_job: save or unsave for the signed-in user. Returns the new
-- state so the UI does not need a second round trip.
-- ---------------------------------------------------------------------------
create or replace function toggle_saved_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  existing uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select id into existing from saved_jobs where user_id = uid and job_id = p_job_id;

  if existing is not null then
    delete from saved_jobs where id = existing;
    update jobs set save_count = greatest(0, save_count - 1) where id = p_job_id;
    return false;
  end if;

  insert into saved_jobs (user_id, job_id) values (uid, p_job_id);
  update jobs set save_count = save_count + 1 where id = p_job_id;
  return true;
end;
$fn$;

grant execute on function toggle_saved_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_consent: append a consent record (PLAN.md section 8, section 12).
-- The exact text shown is hashed so we can prove later what the user agreed to.
-- ---------------------------------------------------------------------------
create or replace function record_consent(
  p_type      consent_type,
  p_version   text,
  p_text_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into consents (user_id, type, version, text_hash)
  values (uid, p_type, p_version, p_text_hash);
end;
$fn$;

grant execute on function record_consent(consent_type, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- my_saved_jobs: the saved list, joined to the job and company.
-- ---------------------------------------------------------------------------
create or replace function my_saved_jobs()
returns table (
  id uuid,
  title_raw text,
  location jsonb,
  seniority seniority_level,
  remote remote_mode,
  hybrid_days_office int,
  employment_type employment_type,
  salary jsonb,
  skills_required text[],
  tech_stack text[],
  posted_at timestamptz,
  first_seen_at timestamptz,
  status job_status,
  company_name text,
  company_slug text,
  saved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    j.id, j.title_raw, j.location, j.seniority, j.remote, j.hybrid_days_office,
    j.employment_type, j.salary, j.skills_required, j.tech_stack,
    j.posted_at, j.first_seen_at, j.status,
    coalesce(c.name_en, c.name_he) as company_name,
    c.slug as company_slug,
    s.created_at as saved_at
  from saved_jobs s
  join jobs j on j.id = s.job_id
  left join companies c on c.id = j.company_id
  where s.user_id = auth.uid()
  order by s.created_at desc;
$fn$;

grant execute on function my_saved_jobs() to authenticated;

-- ---------------------------------------------------------------------------
-- delete_my_account: the one-click delete promised in Consent A.
--
-- Removes the profile, CV rows, consents, saves, searches, swipes, push
-- subscriptions and feedback. `releases` is deliberately NOT deleted: PLAN.md
-- section 12 requires it for 7 years, and it holds no direct identifier — the
-- user id is nulled so the row survives as an unlinked audit record.
--
-- Storage objects and the auth user are removed by the caller with the service
-- role, because neither is reachable from a security-definer function here.
-- ---------------------------------------------------------------------------
create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  delete from saved_jobs           where user_id = uid;
  delete from saved_searches       where user_id = uid;
  delete from swipes               where user_id = uid;
  delete from push_subscriptions   where user_id = uid;
  delete from feedback             where user_id = uid;
  delete from resumes              where user_id = uid;
  delete from employment_verifications where user_id = uid;
  delete from consents             where user_id = uid;
  delete from profiles             where user_id = uid;
end;
$fn$;

grant execute on function delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- company_jobs: open jobs for one company page, newest first.
-- ---------------------------------------------------------------------------
create or replace function company_jobs(p_slug text)
returns setof jobs
language sql
stable
security definer
set search_path = public
as $fn$
  select j.*
  from jobs j
  join companies c on c.id = j.company_id
  where c.slug = p_slug
    and j.status = 'open'
    and j.is_agency = false
  order by coalesce(j.posted_at, j.first_seen_at) desc
  limit 200;
$fn$;

grant execute on function company_jobs(text) to anon, authenticated;
