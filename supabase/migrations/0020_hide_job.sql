-- Hiding a job.
--
-- "Not this one" is the most common reaction to a search result and until now
-- there was nowhere to put it: a seeker scrolling the same wrong job on every
-- visit has no way to say so. Hiding is per-user and reversible.
--
-- It reuses `job_views` rather than adding a table. A hide is a thing you did to
-- a job you saw, exactly like a view or an application, and keeping the three on
-- one row means "jobs I have already dealt with" is one query rather than a
-- three-way join.

alter table job_views
  add column if not exists hidden_at timestamptz;

comment on column job_views.hidden_at is
  'Set when the user hides a job from their results. Null means visible. Reversible.';

create index if not exists job_views_hidden_idx
  on job_views (user_id) where hidden_at is not null;

/**
 * Toggle hidden state. Returns the new state: true when now hidden.
 *
 * Upserts because a job can be hidden before it has ever been "viewed" — the
 * hide button sits on the search card, which is reachable without opening the
 * job at all.
 */
create or replace function toggle_hidden_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select hidden_at into v_now from job_views
   where user_id = v_uid and job_id = p_job_id;

  if v_now is null then
    insert into job_views (user_id, job_id, hidden_at)
    values (v_uid, p_job_id, now())
    on conflict (user_id, job_id) do update set hidden_at = now();
    return true;
  end if;

  update job_views set hidden_at = null
   where user_id = v_uid and job_id = p_job_id;
  return false;
end;
$fn$;

grant execute on function toggle_hidden_job(uuid) to authenticated;

/** Job ids the current user has hidden, for filtering a result set. */
create or replace function my_hidden_job_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select job_id from job_views
   where user_id = auth.uid() and hidden_at is not null;
$fn$;

grant execute on function my_hidden_job_ids() to authenticated;
