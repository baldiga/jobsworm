-- 0053_bump_job_view.sql — count how many visits open a listing.
--
-- `jobs.view_count` has existed since 0003 and nothing has ever written to it.
-- The column was there, the event name `job_view` was already allow-listed in
-- the events sink, and the wire between them was never run.
--
-- ## What this counts, exactly
--
-- One VISIT that opened the listing and stayed a second. Not one person, and
-- not one page load: the client dedupes per browser tab, so a reload does not
-- count twice, and the same reader returning tomorrow does count again. That
-- definition is published, because a number on a public page that nobody can
-- define is worse than no number.
--
-- A tracking blocker stops it, so the real figure is higher than the shown one,
-- never lower. Same direction of error as the sponsored impression counter, and
-- the same reason: an undercount we can describe beats an overcount we cannot.
--
-- ## Why it stores nothing about the visitor
--
-- This mirrors `bump_apply_click` (0010) deliberately, down to the revoke. The
-- events sink writes a row with a null `user_id` and a null `session_id`, and
-- this bumps a per-job integer. There is no join anywhere from a view to a
-- person, which is what lets the count be shown publicly without touching
-- `job_views` — the signed-in reader's own history, which is consented personal
-- data and stays private.
--
-- Service-role only. A counter the browser could increment directly is a
-- counter that means nothing.

create or replace function bump_job_view(p_job_id uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update jobs
     set view_count = coalesce(view_count, 0) + 1
   where id = p_job_id;
$fn$;

/*
 * REVOKE FROM PUBLIC, not from anon and authenticated.
 *
 * This is the whole point of the assertion below, and it caught a live hole in
 * `bump_apply_click` on the way in. Postgres grants EXECUTE on a new function
 * to PUBLIC by default, and PostgREST's `anon` role inherits it. Revoking from
 * `anon` and `authenticated` by name removes grants those roles never had:
 * the ACL still reads `=X/postgres`, the leading `=` being PUBLIC, and both
 * roles can still call it.
 *
 * `bump_apply_click` has carried that mistake since 0010. It is SECURITY
 * DEFINER, so RLS does not save it either — any visitor could POST to
 * /rest/v1/rpc/bump_apply_click and inflate any listing's apply counters,
 * which feed the ghost meter and the figures a recruiter is shown. Fixed
 * below, because it is the same bug and finding it here is when it gets fixed.
 */
revoke execute on function bump_job_view(uuid) from public, anon, authenticated;
revoke execute on function bump_apply_click(uuid) from public, anon, authenticated;

/*
 * Read path for the public counter.
 *
 * `search_jobs` has 43 explicit OUT columns and `match_jobs_for` has 22, so
 * carrying `view_count` through them means dropping and recreating the two
 * busiest functions on the site. 0051 already declined that once for the
 * company logo and said why.
 *
 * This is the alternative: one tiny function, keyed on the ids a page has
 * already fetched, called once per page from the browser. `jobs` has RLS on
 * with a policy for open rows only, and this is STABLE and SECURITY INVOKER —
 * it cannot reveal a job the caller could not already read.
 *
 * Capped inside the function as well as in the route. A limit enforced only by
 * the caller is not a limit.
 */
create or replace function job_view_counts(p_ids uuid[])
returns table (id uuid, views int)
language sql
stable
set search_path = public
as $fn$
  select j.id, coalesce(j.view_count, 0)::int
    from jobs j
   where j.id = any(p_ids[1:60])
     and j.status = 'open';
$fn$;

grant execute on function job_view_counts(uuid[]) to anon, authenticated;

do $check$
begin
  assert (select prosecdef from pg_proc where proname = 'bump_job_view'),
    'bump_job_view must be SECURITY DEFINER';
  -- The browser must never be able to inflate a public number directly.
  assert not has_function_privilege('anon', 'bump_job_view(uuid)', 'execute'),
    'anon can execute bump_job_view';
  assert not has_function_privilege('authenticated', 'bump_job_view(uuid)', 'execute'),
    'authenticated can execute bump_job_view';
  -- The one this migration found. Same check, so it cannot regress quietly.
  assert not has_function_privilege('anon', 'bump_apply_click(uuid)', 'execute'),
    'anon can execute bump_apply_click';
  -- The read path is invoker, so RLS on `jobs` still applies to it.
  assert not (select prosecdef from pg_proc where proname = 'job_view_counts'),
    'job_view_counts must NOT be SECURITY DEFINER';
end
$check$;
