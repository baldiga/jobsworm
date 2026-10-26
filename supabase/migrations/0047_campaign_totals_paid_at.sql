-- 0047_campaign_totals_paid_at.sql — the dashboard needs to know what is paid.
--
-- The listings table gained a Delete button, and it may only be offered where
-- it can actually work: `cancel_my_campaign` refuses a paid campaign, because
-- ending one early is a refund conversation rather than a button. Showing the
-- button anyway and explaining afterwards why it did nothing is worse than not
-- showing it.
--
-- `status` cannot answer the question. A FREE listing goes live without any
-- payment, so 'live' means paid for a sponsored campaign and unpaid for a free
-- one — and treating 'live' as paid would take the button away from exactly
-- the free drafts people most want to clear out. `paid_at` is the fact the
-- decision actually rests on, so the RPC returns it instead of asking the page
-- to infer it.
--
-- DROP and recreate, not `create or replace`: Postgres refuses to change the
-- OUT row type of an existing function, which has already cost one migration
-- in this project. The grant has to be reapplied for the same reason.

drop function if exists recruiter_campaign_totals();

create or replace function recruiter_campaign_totals()
returns table (
  campaign_id uuid, status text, kind text, plan text, title_snapshot text,
  job_id uuid, days int, price_usd numeric, paid_at timestamptz,
  starts_at timestamptz, ends_at timestamptz, days_left int,
  impressions bigint, card_views bigint, apply_clicks bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  select c.id, c.status, c.kind, c.plan, c.title_snapshot, c.job_id, c.days,
         c.price_usd, c.paid_at, c.starts_at, c.ends_at,
         case when c.status <> 'live' or c.ends_at is null then null
              else greatest(0, ceil(extract(epoch from (c.ends_at - now())) / 86400.0)::int)
         end,
         coalesce(sum(d.impressions_home + d.impressions_search), 0)::bigint,
         coalesce(sum(d.card_views), 0)::bigint,
         coalesce(sum(d.apply_clicks), 0)::bigint
  from campaigns c
  left join campaign_stats_daily d on d.campaign_id = c.id
  where c.recruiter_id = auth.uid()
  group by c.id
  order by c.created_at desc;
$fn$;

grant execute on function recruiter_campaign_totals() to authenticated;

-- The filter still has to be `auth.uid()` and nothing else: this is the one
-- function a recruiter's browser calls to list campaigns, and a missing
-- predicate here would hand every recruiter everybody else's numbers.
do $check$
begin
  assert (
    select prosecdef from pg_proc where proname = 'recruiter_campaign_totals'
  ), 'recruiter_campaign_totals must stay SECURITY DEFINER';
  assert (
    select pg_get_functiondef(oid) like '%auth.uid()%'
      from pg_proc where proname = 'recruiter_campaign_totals'
  ), 'recruiter_campaign_totals lost its auth.uid() filter';
end
$check$;
