-- 0007_rls.sql
-- Jobsworm - Row Level Security.
-- PLAN.md section 3 ("RLS: owner only; agencies only via security-definer RPCs")
-- and section 12 (Amendment 13: purpose limitation, audit, medium security level).
--
-- Rules of thumb encoded here:
--   * Every people table and every agency table has RLS ENABLED.
--   * Seekers reach only their own rows, through auth.uid().
--   * releases / salary_points / contributions_index are never client-writable.
--   * The service role bypasses RLS entirely; that is the only path for
--     ingestion, nightly jobs and (post-MVP) agency RPCs.
--   * auth.uid() is wrapped in a scalar subselect so the planner evaluates it
--     once per statement instead of once per row.

-- ===========================================================================
-- Public read surface: companies + open jobs
-- PLAN.md 7.1: browsing works with no account at all - this is also what makes
-- SEO work. Only apply-click / save / alerts / match are gated.
-- ===========================================================================
alter table companies enable row level security;
alter table jobs enable row level security;

create policy companies_public_read
  on companies for select
  to anon, authenticated
  using (true);

-- Draft and closed jobs stay invisible to clients.
create policy jobs_public_read_open
  on jobs for select
  to anon, authenticated
  using (status = 'open');

-- ===========================================================================
-- events: write-only telemetry
-- Clients may append; nobody may read back. Anonymous events must not claim
-- a user id, and signed-in events may only claim their own.
-- ===========================================================================
alter table events enable row level security;

create policy events_client_insert
  on events for insert
  to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- (No select / update / delete policy: analytics is read via the service role.)

-- ===========================================================================
-- People tables - owner only
-- ===========================================================================

-- profiles (owner column is the primary key, user_id) ------------------------
alter table profiles enable row level security;

create policy profiles_select_own on profiles for select
  to authenticated using ((select auth.uid()) = user_id);
create policy profiles_insert_own on profiles for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy profiles_update_own on profiles for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy profiles_delete_own on profiles for delete
  to authenticated using ((select auth.uid()) = user_id);

-- resumes --------------------------------------------------------------------
alter table resumes enable row level security;

create policy resumes_select_own on resumes for select
  to authenticated using ((select auth.uid()) = user_id);
create policy resumes_insert_own on resumes for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy resumes_update_own on resumes for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy resumes_delete_own on resumes for delete
  to authenticated using ((select auth.uid()) = user_id);

-- consents -------------------------------------------------------------------
-- Note: consents are an append-only legal record kept 7 years (PLAN.md 12).
-- Update exists only so the owner can set revoked_at; the app must never
-- rewrite version / text_hash / ts.
alter table consents enable row level security;

create policy consents_select_own on consents for select
  to authenticated using ((select auth.uid()) = user_id);
create policy consents_insert_own on consents for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy consents_update_own on consents for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy consents_delete_own on consents for delete
  to authenticated using ((select auth.uid()) = user_id);

-- swipes ---------------------------------------------------------------------
alter table swipes enable row level security;

create policy swipes_select_own on swipes for select
  to authenticated using ((select auth.uid()) = user_id);
create policy swipes_insert_own on swipes for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy swipes_update_own on swipes for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy swipes_delete_own on swipes for delete
  to authenticated using ((select auth.uid()) = user_id);

-- saved_jobs -----------------------------------------------------------------
alter table saved_jobs enable row level security;

create policy saved_jobs_select_own on saved_jobs for select
  to authenticated using ((select auth.uid()) = user_id);
create policy saved_jobs_insert_own on saved_jobs for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy saved_jobs_update_own on saved_jobs for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy saved_jobs_delete_own on saved_jobs for delete
  to authenticated using ((select auth.uid()) = user_id);

-- saved_searches -------------------------------------------------------------
alter table saved_searches enable row level security;

create policy saved_searches_select_own on saved_searches for select
  to authenticated using ((select auth.uid()) = user_id);
create policy saved_searches_insert_own on saved_searches for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy saved_searches_update_own on saved_searches for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy saved_searches_delete_own on saved_searches for delete
  to authenticated using ((select auth.uid()) = user_id);

-- push_subscriptions ---------------------------------------------------------
alter table push_subscriptions enable row level security;

create policy push_subscriptions_select_own on push_subscriptions for select
  to authenticated using ((select auth.uid()) = user_id);
create policy push_subscriptions_insert_own on push_subscriptions for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy push_subscriptions_update_own on push_subscriptions for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy push_subscriptions_delete_own on push_subscriptions for delete
  to authenticated using ((select auth.uid()) = user_id);

-- feedback -------------------------------------------------------------------
alter table feedback enable row level security;

create policy feedback_select_own on feedback for select
  to authenticated using ((select auth.uid()) = user_id);
create policy feedback_insert_own on feedback for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy feedback_update_own on feedback for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy feedback_delete_own on feedback for delete
  to authenticated using ((select auth.uid()) = user_id);

-- employment_verifications ---------------------------------------------------
alter table employment_verifications enable row level security;

create policy employment_verifications_select_own on employment_verifications for select
  to authenticated using ((select auth.uid()) = user_id);
create policy employment_verifications_insert_own on employment_verifications for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy employment_verifications_update_own on employment_verifications for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy employment_verifications_delete_own on employment_verifications for delete
  to authenticated using ((select auth.uid()) = user_id);

-- ===========================================================================
-- releases - immutable disclosure log
-- The seeker can read their own rows (this is the "who saw me" screen).
-- No insert / update / delete policy exists for anon or authenticated:
-- only the service role writes here, and nothing ever rewrites or removes a
-- row. 7-year retention (PLAN.md section 12).
-- ===========================================================================
alter table releases enable row level security;

create policy releases_select_own
  on releases for select
  to authenticated
  using ((select auth.uid()) = profile_id);

-- ===========================================================================
-- salary_points / contributions_index - RLS enabled, ZERO policies.
-- Salary data is specially sensitive under Amendment 13 (PLAN.md section 12);
-- it is unlinked from identity at write time and is reachable only through the
-- service role and, later, aggregate-only security-definer functions that
-- enforce the "effective n >= 8" disclosure floor (PLAN.md 5.4).
-- Do NOT add a policy here.
-- ===========================================================================
alter table salary_points enable row level security;
alter table contributions_index enable row level security;

-- ===========================================================================
-- Agency + referrer tables - RLS enabled, no public policies yet.
-- The agency product lands POST-MVP (PLAN.md 9.5) and will be exposed through
-- SECURITY DEFINER RPCs (shortlist / request_intro / respond_to_intro) that
-- enforce Consent B, exclusions and the double opt-in state machine, plus write
-- the releases audit row. Until those RPCs exist these tables are service-role
-- only, which is the correct default.
-- ===========================================================================
alter table agencies enable row level security;
alter table agency_users enable row level security;
alter table agency_roles enable row level security;
alter table intros enable row level security;
alter table referrers enable row level security;
alter table referral_requests enable row level security;

-- ===========================================================================
-- Supply-side / operational tables: RLS on, no client policies.
-- job_signals and the crawler tables are surfaced to the UI only as aggregates
-- through security-definer functions, never queried directly by clients.
-- ===========================================================================
alter table job_signals enable row level security;
alter table raw_posts enable row level security;
alter table raw_pages enable row level security;
alter table sources enable row level security;
alter table runs enable row level security;
alter table metrics enable row level security;
