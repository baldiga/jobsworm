-- Collapse duplicate open listings.
--
-- MEASURED before writing this, because the reported problem and the real one
-- were not the same. The report was "AllJobs and Drushim both list the same job,
-- so we show it twice". Across 6,461 open listings:
--
--     same fingerprint, different source   1 listing
--     identical description, different src  0 listings
--     same fingerprint, SAME source       508 listings  (7.9% of the index)
--
-- So cross-source duplication is already handled and is not worth code. What is
-- real is the same source listing the same job more than once, most of it from
-- the ATS feeds: Comeet 149, Ashby 40, Greenhouse 27, Drushim 27, Facebook 23.
-- That happens when an employer reposts a role and the ATS issues a new id, or
-- posts one role against several locations. `source_external_id` differs, so the
-- upsert has no way to see they are the same job.
--
-- An early attempt to detect this by hashing the excerpt was wrong and is worth
-- recording: it flagged 1,451 listings, but the excerpt is the first 300
-- characters of the description and for most employers that is the "about us"
-- boilerplate repeated on every role. It was grouping four different jobs at one
-- company as duplicates. The fingerprint (company + normalised title + city) is
-- the honest key.
--
-- Duplicates are CLOSED, not deleted. Closing already hides them from search, it
-- is reversible, and it keeps the row so an application someone already made
-- still resolves.

create or replace function dedupe_open_jobs()
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
  )
  update jobs j
     set status = 'closed',
         closed_at = now(),
         quality_flags = coalesce(j.quality_flags, '{}'::jsonb)
                         || jsonb_build_object('closed_reason', 'duplicate')
    from ranked r
   where j.id = r.id
     and r.rn > 1;

  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

comment on function dedupe_open_jobs() is
  'Closes open listings that share a fingerprint with a better copy. Keeps the employer-direct source, then the most recently seen. Reversible: rows are closed, never deleted.';

-- Runs alongside the existing expiry sweep. The database already had a daily
-- cleanup schedule, so this needs no external runner and works whether or not
-- anyone''s laptop is on.
do $cron$
begin
  perform cron.schedule(
    'jobswarm-dedupe-jobs',
    '35 2 * * *',
    $job$select dedupe_open_jobs()$job$
  );
  raise notice 'dedupe schedule installed';
exception
  when others then
    raise notice 'pg_cron unavailable, skipping dedupe schedule: %', sqlerrm;
end;
$cron$;
