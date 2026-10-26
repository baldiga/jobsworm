-- Fix: `jobs.quality_flags` is text[], not jsonb.
--
-- 0021 built the marker with jsonb_build_object and the function failed at run
-- time with "COALESCE types text[] and jsonb cannot be matched". The flag is
-- appended to the array instead, and only when it is not already there, so
-- re-running the sweep cannot grow the array without bound.

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
         quality_flags = case
           when 'duplicate' = any(coalesce(j.quality_flags, '{}'))
             then j.quality_flags
           else array_append(coalesce(j.quality_flags, '{}'), 'duplicate')
         end
    from ranked r
   where j.id = r.id
     and r.rn > 1;

  get diagnostics affected = row_count;
  return affected;
end;
$fn$;
