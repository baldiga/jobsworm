-- Seeker profile, CV-based matching, and view/apply tracking.
--
-- PLAN.md section 8 defines the profile; section 7.2 defines the funnel that
-- needs the tracking. Matching here is skill-and-title overlap rather than the
-- vector search in section 6: embeddings arrive with F8, and a keyword match we
-- can ship today beats a vector match we cannot.

-- ---------------------------------------------------------------------------
-- profiles: the fields the CV parser fills and the user can correct
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists headline           text,
  add column if not exists years_experience   int,
  add column if not exists skills             text[] not null default '{}',
  add column if not exists preferred_titles   text[] not null default '{}',
  add column if not exists cv_parsed_at       timestamptz;

comment on column profiles.skills is
  'Normalized skill tokens, from the CV parser or edited by the user. Drives matching.';

-- ---------------------------------------------------------------------------
-- job_views: what the seeker has looked at, and whether they applied
-- ---------------------------------------------------------------------------
create table if not exists job_views (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      uuid not null references jobs(id) on delete cascade,
  viewed_at   timestamptz not null default now(),
  view_count  int not null default 1,
  -- Self-reported. We cannot observe an application that happens on the
  -- employer's own site, so the user tells us.
  applied_at  timestamptz,
  -- Answer to "did you hear back?", asked 14 days after applying (PLAN 7.3).
  heard_back  boolean,
  note        text,
  created_at  timestamptz not null default now(),
  constraint job_views_unique unique (user_id, job_id)
);

create index if not exists job_views_user_viewed_idx on job_views (user_id, viewed_at desc);
create index if not exists job_views_user_applied_idx on job_views (user_id, applied_at desc)
  where applied_at is not null;

comment on table job_views is
  'Per-user view and application history. Applied state is self-reported: the application itself happens on the employer site.';

alter table job_views enable row level security;

create policy job_views_owner_select on job_views for select
  to authenticated using ((select auth.uid()) = user_id);
create policy job_views_owner_insert on job_views for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy job_views_owner_update on job_views for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy job_views_owner_delete on job_views for delete
  to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- record_job_view: upsert a view, optionally flipping the applied flag
-- ---------------------------------------------------------------------------
create or replace function record_job_view(p_job_id uuid, p_applied boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;  -- anonymous browsing is allowed and simply not tracked
  end if;

  insert into job_views (user_id, job_id, viewed_at, applied_at)
  values (uid, p_job_id, now(), case when p_applied then now() end)
  on conflict (user_id, job_id) do update
    set viewed_at  = now(),
        view_count = job_views.view_count + 1,
        -- Applying is sticky: a later plain view must not clear it, and
        -- explicitly passing false un-marks it.
        applied_at = case
                       when p_applied is true then coalesce(job_views.applied_at, now())
                       when p_applied is false then null
                       else job_views.applied_at
                     end;
end;
$fn$;

grant execute on function record_job_view(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- my_job_activity: the /me history list
-- ---------------------------------------------------------------------------
create or replace function my_job_activity(p_only_applied boolean default false)
returns table (
  id uuid,
  title_raw text,
  company_name text,
  company_slug text,
  location jsonb,
  seniority seniority_level,
  remote remote_mode,
  salary jsonb,
  status job_status,
  source_provider text,
  viewed_at timestamptz,
  applied_at timestamptz,
  heard_back boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    j.id, j.title_raw,
    coalesce(c.name_en, c.name_he, j.company_name_raw) as company_name,
    c.slug as company_slug,
    j.location, j.seniority, j.remote, j.salary, j.status, j.source_provider,
    v.viewed_at, v.applied_at, v.heard_back
  from job_views v
  join jobs j on j.id = v.job_id
  left join companies c on c.id = j.company_id
  where v.user_id = auth.uid()
    and (not p_only_applied or v.applied_at is not null)
  order by coalesce(v.applied_at, v.viewed_at) desc
  limit 200;
$fn$;

grant execute on function my_job_activity(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- match_jobs_for_me: CV-based matching, without embeddings
-- ---------------------------------------------------------------------------
-- Scores on overlap between the profile's skills and the job's required
-- skills and tech stack, plus a title-similarity term and the same freshness
-- and ghost adjustments search uses. The vector leg replaces the skill term
-- once F8 backfills embeddings; the shape of the result does not change.
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
  score real
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
      p.seniority as want_seniority
    from profiles p
    where p.user_id = auth.uid()
  )
  select
    j.id, j.title_raw,
    coalesce(c.name_en, c.name_he, j.company_name_raw) as company_name,
    c.slug as company_slug,
    j.location, j.seniority, j.remote, j.employment_type, j.salary,
    j.skills_required, j.tech_stack, j.excerpt, j.source_provider, j.posted_at,
    array(
      select unnest(coalesce(j.skills_required, '{}') || coalesce(j.tech_stack, '{}'))
      intersect
      select unnest(me.skills)
    ) as matched_skills,
    (
      -- Skill overlap dominates, normalized so a job listing thirty skills
      -- does not outrank a focused one purely on volume.
      (cardinality(array(
        select unnest(coalesce(j.skills_required, '{}') || coalesce(j.tech_stack, '{}'))
        intersect
        select unnest(me.skills)
      ))::real / greatest(1, least(cardinality(me.skills), 12))) * 1.0
      -- Title affinity.
      + coalesce((
          select max(similarity(j.title_norm, t)) from unnest(me.titles) t
        ), 0) * 0.5
      -- Seniority agreement.
      + case when me.want_seniority is not null and j.seniority = me.want_seniority
             then 0.25 else 0 end
      -- Region preference.
      + case when me.regions is not null and array_length(me.regions, 1) > 0
                  and (j.location ->> 'region') = any(me.regions)
             then 0.2 else 0 end
      -- Freshness, and the ghost penalty search already applies.
      + (1.0 / (1.0 + (extract(epoch from (now() - coalesce(j.posted_at, j.first_seen_at))) / 86400.0)))::real * 0.15
      - (coalesce(j.ghost_score, 0)::real / 100.0) * 0.2
    )::real as score
  from jobs j
  cross join me
  left join companies c on c.id = j.company_id
  where j.status = 'open'
    and j.is_agency = false
    -- At least one real skill in common, otherwise it is not a match.
    and (coalesce(j.skills_required, '{}') || coalesce(j.tech_stack, '{}')) && me.skills
  order by score desc, coalesce(j.posted_at, j.first_seen_at) desc
  limit greatest(1, least(coalesce(p_limit, 40), 100))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;

grant execute on function match_jobs_for_me(int, int) to authenticated;
