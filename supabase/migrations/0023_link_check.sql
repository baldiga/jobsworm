-- Dead-listing sweep.
--
-- A listing can disappear at the source while still looking open to us: we only
-- learn a job closed when a later crawl stops returning it, and the boards do
-- not always drop it from the feed. A seeker clicks through and gets "job no
-- longer available", which is the single most annoying failure this product can
-- produce, because it wasted a click on something we promised was open.
--
-- Neither board returns an error for a dead job. Both answer HTTP 200:
--
--     AllJobs   200, page body contains "המשרה נמחקה" (the job was deleted)
--     Drushim   200, but redirects /job/<id>/ to the site root
--
-- So a status-code check finds neither, and the worker has to look at the body
-- and the final URL. That check lives in Python (apps/worker linkcheck.py); this
-- migration only provides the bookkeeping it needs.

alter table jobs
  add column if not exists link_checked_at timestamptz;

comment on column jobs.link_checked_at is
  'Last time the apply URL was fetched and confirmed live. Null means never checked.';

-- Drives "oldest unchecked first", so a run always works on the stalest rows.
create index if not exists jobs_link_check_queue_idx
  on jobs (link_checked_at nulls first)
  where status = 'open';

/**
 * Mark listings dead after a link check.
 *
 * Closed rather than deleted, like every other close in this schema: it is
 * reversible, it keeps an application someone already made resolvable, and
 * `status = 'open'` is what search filters on anyway.
 */
create or replace function close_dead_jobs(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  affected integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  update jobs j
     set status = 'closed',
         closed_at = now(),
         link_checked_at = now(),
         quality_flags = case
           when 'dead_link' = any(coalesce(j.quality_flags, '{}'))
             then j.quality_flags
           else array_append(coalesce(j.quality_flags, '{}'), 'dead_link')
         end
   where j.id = any(p_ids)
     and j.status = 'open';

  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

/** Record that a listing was checked and is still live. */
create or replace function touch_link_checked(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  affected integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  update jobs set link_checked_at = now() where id = any(p_ids);
  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

comment on function close_dead_jobs(uuid[]) is
  'Closes listings whose source page reports the job is gone. Reversible.';
