-- 0055_lock_remaining_definers.sql — five more, and a guard so there is not a
-- sixth.
--
-- ## Why there is a second pass
--
-- 0054 closed the functions I had gone looking for: the money path and the
-- maintenance routines. It did not close the ones I had not thought to list,
-- and Supabase's own linter names them — `anon_security_definer_function_
-- executable`, 32 findings. Twenty-seven of those are fine: they are either
-- public reads (`search_jobs`, `site_stats`) or they gate on `auth.uid()`
-- internally, so an anonymous caller gets an empty result rather than
-- somebody else's data.
--
-- Five were not fine. Verified against production with the publishable key:
--
--     POST /rpc/match_jobs_for {"p_user":"<someone else>"}  -> 200, their matches
--     POST /rpc/cv_is_fresh {"p_user":"<someone else>"}      -> 200, true
--     POST /rpc/recruiter_free_quota_for {"p_user":"…"}      -> 200, their quota
--     POST /rpc/touch_link_checked {"p_ids":[]}              -> 200
--     POST /rpc/close_dead_jobs {"p_ids":[]}                 -> 200
--
-- ## What each one was
--
-- `match_jobs_for` is the serious one, and it is serious because it was meant
-- to be closed. 0042 split the matcher into a wrapper that reads `auth.uid()`
-- and an inner function that takes the user id as a parameter, and wrote in the
-- file: "it is revoked from anon and authenticated, and only the wrapper is
-- granted. The browser can ask about itself and has no way to ask about anybody
-- else." The revoke named two roles and the grant it needed to remove was held
-- by PUBLIC, so the sentence was false from the day it was written. Anyone with
-- a user id could read that person's matches, and `matched_skills` is the
-- intersection of their CV with the listing — page through enough jobs and you
-- recover the skill list off their CV. That is consented personal data, handed
-- to a stranger.
--
-- `cv_is_fresh` and `recruiter_free_quota_for` leak less (a boolean, four small
-- integers) but leak it about a named person, and both carry the same dead
-- revoke, from 0044 and 0034.
--
-- `close_dead_jobs` and `touch_link_checked` are different: no revoke was ever
-- written, and they hold explicit `anon=X` and `authenticated=X` grants as well
-- as the PUBLIC one, so this has to remove all three. They are called once a
-- day by the link checker in `apps/worker/jobswarm_scrape/cli.py`, over the
-- service role. `close_dead_jobs` closes any listing whose id you pass. With
-- 4,162 open jobs and no rate limit in front of it, one loop empties the site.
--
-- ## The part that matters more than the five
--
-- This is the third time this bug has been found by looking rather than by
-- failing, which means looking is the control, and looking does not scale. The
-- assertion at the bottom inverts it: every SECURITY DEFINER function that anon
-- can execute must be named in ALLOWED. Add a public RPC and you add a line
-- saying you meant it; forget, and the deploy stops. A new function inherits
-- the PUBLIC grant by default, so the default case is the one that fails.

do $revoke$
declare
  fn text;
  sig text;
begin
  foreach fn in array array[
    -- Take a user id and answer about that user. The wrapper each one has
    -- (`match_jobs_for_me`, `cv_freshness_for_me`, `recruiter_free_quota`)
    -- reads auth.uid() and stays granted.
    'match_jobs_for', 'cv_is_fresh', 'recruiter_free_quota_for',
    -- Write to `jobs`. Link checker only, over the service role.
    'close_dead_jobs', 'touch_link_checked'
  ]
  loop
    for sig in
      select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
    loop
      execute format('revoke execute on function public.%s from public, anon, authenticated', sig);
      raise notice 'revoked public.%', sig;
    end loop;
  end loop;
end
$revoke$;

/*
 * The guard.
 *
 * Everything in ALLOWED is anon-executable on purpose and falls into two
 * groups. Public reads return the same rows to everybody and hold nothing
 * personal. The rest read `auth.uid()` themselves, so anonymously they return
 * nothing — `anon` can call them, and that is not the same as anon getting
 * anything, which is why they are listed rather than revoked.
 *
 * A function missing from this list is not necessarily a hole. It is a function
 * nobody has decided about, which is how all eighteen of the ones fixed today
 * got here.
 */
do $check$
declare
  allowed constant text[] := array[
    -- Public reads. Same answer for every caller.
    'company_jobs', 'search_facet_rows', 'search_facets', 'search_jobs',
    'search_jobs_count', 'site_stats', 'sponsored_jobs',
    -- Gated on auth.uid() inside the function body.
    'cancel_my_campaign', 'withdraw_my_campaign', 'confirm_cv_current',
    'cv_freshness_for_me', 'cv_gaps_for_me', 'delete_my_account',
    'match_jobs_for_me', 'my_hidden_job_ids', 'my_job_activity',
    'my_saved_jobs', 'record_consent', 'record_job_view',
    'toggle_hidden_job', 'toggle_saved_job',
    'recruiter_campaign_stats', 'recruiter_campaign_totals',
    'recruiter_free_quota', 'recruiter_me', 'recruiter_my_campaigns',
    'recruiter_site_stats'
  ];
  unexpected text;
begin
  select string_agg(distinct p.proname, ', ' order by p.proname) into unexpected
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and not (p.proname = any(allowed));

  assert unexpected is null,
    'SECURITY DEFINER functions anon can execute that nobody decided about: '
    || coalesce(unexpected, '')
    || ' — either revoke execute from public, anon, authenticated, or add the '
    || 'name to the allow-list in this migration and say why in the comment.';

  -- The five above, by name, so a `create or replace` that restores the PUBLIC
  -- default fails here rather than quietly reopening.
  assert not has_function_privilege('anon', 'match_jobs_for(uuid, integer, integer)', 'execute'),
    'anon can execute match_jobs_for';
  assert not has_function_privilege('anon', 'close_dead_jobs(uuid[])', 'execute'),
    'anon can execute close_dead_jobs';

  -- And the link checker must still run tonight.
  assert has_function_privilege('service_role', 'close_dead_jobs(uuid[])', 'execute'),
    'service_role lost execute on close_dead_jobs';
  assert has_function_privilege('service_role', 'touch_link_checked(uuid[])', 'execute'),
    'service_role lost execute on touch_link_checked';
  -- The wrapper is what the browser uses; revoking the inner one must not have
  -- touched it.
  assert has_function_privilege('authenticated', 'match_jobs_for_me(integer, integer)', 'execute'),
    'authenticated lost execute on match_jobs_for_me';
end
$check$;
