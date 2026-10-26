-- 0037_hygiene_batched_crons.sql — put a ceiling on the nightly sweeps.
--
-- Both of these functions were written to do all their work in one statement.
-- That was fine when the index held a few hundred rows. It is not fine now:
-- `dedupe_open_jobs()` ranks every open job with a window function and can
-- close thousands in a single transaction, on a shared instance whose CPU has
-- already put the site into 503s twice.
--
-- The fix is the same one the ingest loop uses: a batch limit, run more often.
-- A capped statement that runs every ten minutes clears the same backlog as an
-- uncapped one that runs once, but it never holds a long transaction and never
-- competes with live search for more than a second at a time.
--
-- Both functions keep their old call shape: the new argument has a default, so
-- `select expire_stale_jobs()` still resolves. Postgres will not accept an
-- overload whose defaults make a zero-argument call ambiguous, which is why
-- each one is dropped before it is recreated rather than `create or replace`d.

-- ---------------------------------------------------------------------------
-- expire_stale_jobs(p_limit) — close link-out and social postings past their
-- expiry (PLAN.md 4.4). Uses jobs_expires_at_open_idx.
-- ---------------------------------------------------------------------------
drop function if exists expire_stale_jobs();

create or replace function expire_stale_jobs(p_limit int default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  affected integer;
begin
  with due as (
    select j.id
      from jobs j
     where j.status = 'open'
       and j.expires_at is not null
       and j.expires_at < now()
     order by j.expires_at
     limit greatest(1, coalesce(p_limit, 500))
     -- Another pass holding these rows means they are already being closed.
     for update skip locked
  )
  update jobs j
     set status = 'closed',
         closed_at = now()
    from due
   where j.id = due.id;

  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

comment on function expire_stale_jobs(int) is
  'Closes up to p_limit expired open jobs. Batched deliberately: see 0037.';

-- ---------------------------------------------------------------------------
-- dedupe_open_jobs(p_limit) — close duplicate open rows, keeping the best copy
-- of each fingerprint. Body is 0022 verbatim apart from the limit.
-- ---------------------------------------------------------------------------
drop function if exists dedupe_open_jobs();

create or replace function dedupe_open_jobs(p_limit int default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  affected integer;
begin
  with ranked as (
    select
      j.id,
      row_number() over (
        partition by j.fingerprint
        order by
          -- Applying on the employer's own system beats a board relay, so when
          -- the same job exists twice the direct one is the copy worth keeping.
          case
            when j.source_provider in (
              'comeet','greenhouse','lever','ashby','workable',
              'smartrecruiters','recruitee','workday','personio','bamboohr'
            ) then 0
            when j.source_provider in ('drushim','alljobs','yad2') then 1
            else 2
          end,
          -- Then the one we have seen most recently, then the newest posting.
          j.last_seen_at desc nulls last,
          coalesce(j.posted_at, j.first_seen_at) desc nulls last,
          j.id
      ) as rn
    from jobs j
    where j.status = 'open'
      and j.fingerprint is not null
  ),
  losers as (
    select r.id from ranked r where r.rn > 1
     -- Deterministic batch. Each pass closes the rows it takes, so they drop
     -- out of `ranked` and the next pass moves on through the backlog.
     order by r.id
     limit greatest(1, coalesce(p_limit, 500))
  )
  update jobs j
     set status = 'closed',
         closed_at = now(),
         quality_flags = case
           when 'duplicate' = any(coalesce(j.quality_flags, '{}'))
             then j.quality_flags
           else array_append(coalesce(j.quality_flags, '{}'), 'duplicate')
         end
    from losers l
   where j.id = l.id;

  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

comment on function dedupe_open_jobs(int) is
  'Closes up to p_limit duplicate open jobs, keeping the best copy per fingerprint. Batched deliberately: see 0037.';

-- ---------------------------------------------------------------------------
-- Schedules.
--
-- pg_cron is unavailable on local `supabase start` and on some hosted tiers,
-- so the whole block is guarded exactly as 0009 is: where the extension cannot
-- be created the migration logs a notice and succeeds, keeping `db reset`
-- green everywhere.
--
-- cron.schedule() on an existing job name replaces it, so re-running this is
-- safe and the 0009 schedule for jobswarm-expire-jobs is simply overwritten.
-- ---------------------------------------------------------------------------
do $cron$
begin
  create extension if not exists pg_cron;

  -- Hourly rather than nightly. Capped at 500 it is a cheap indexed statement
  -- that usually closes nothing, and a job whose expiry passed at 09:00 should
  -- not stay on the site until 02:15 the next morning.
  perform cron.schedule(
    'jobswarm-expire-jobs',
    '35 * * * *',
    $job$select expire_stale_jobs(500)$job$
  );

  -- Six capped passes inside one quiet hour: 3,000 rows a night, which is far
  -- more than a day ever produces. This has never been scheduled before — the
  -- sweep was run by hand — so duplicates have been accumulating between runs.
  --
  -- 03:00 UTC is inside the window the database crons own and well clear of
  -- the 05:17 scrape.
  perform cron.schedule(
    'jobswarm-dedupe-jobs',
    '*/10 3 * * *',
    $job$select dedupe_open_jobs(500)$job$
  );

  raise notice 'batched hygiene schedules installed';
exception
  when others then
    raise notice 'pg_cron unavailable (%), skipping schedules.', sqlerrm;
end
$cron$;
