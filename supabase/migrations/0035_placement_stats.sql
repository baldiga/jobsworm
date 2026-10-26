-- 0035_placement_stats.sql — the numbers a recruiter is shown.
--
-- These are the tables the Phase 1 rollup has been writing into (or failing to
-- write into, and saying so in its `notes`) since it shipped. PostHog holds
-- the events; this holds the counts, for three reasons:
--
--   Ownership. A recruiter may see their own campaign and nobody else's.
--   Against a shared analytics project that means trusting a query string;
--   here it means `auth.uid()` in an RPC, the same mechanism guarding
--   everything else on the site.
--
--   Speed. PostHog's query API is rate-limited and takes seconds. A dashboard
--   querying it directly would be slow on every load and would fall over
--   exactly when several recruiters looked at once.
--
--   Survivability. If PostHog is down or the key is rotated, the recruiter
--   sees yesterday's numbers rather than an error.
--
-- Both tables are keyed by day so the hourly rollup's re-read of the last two
-- days is idempotent.

create table site_stats_daily (
  day             date primary key,
  visits          bigint not null default 0,
  unique_visitors bigint not null default 0,
  searches        bigint not null default 0,
  updated_at      timestamptz not null default now()
);

create table campaign_stats_daily (
  campaign_id        uuid not null references campaigns(id) on delete cascade,
  day                date not null,
  impressions_home   bigint not null default 0,
  impressions_search bigint not null default 0,
  card_views         bigint not null default 0,
  apply_clicks       bigint not null default 0,
  updated_at         timestamptz not null default now(),
  primary key (campaign_id, day)
);

alter table site_stats_daily     enable row level security;
alter table campaign_stats_daily enable row level security;
-- No policies. Reads go through the two RPCs below.

-- ---------------------------------------------------------------------------
-- recruiter_site_stats — site-wide totals, for any active recruiter.
--
-- This is the transparency half of the pitch: before buying, you can see how
-- much traffic there is to buy into. It is deliberately aggregate-only — no
-- breakdown by anything that could identify a visitor — and gated on being an
-- active recruiter rather than merely signed in, so it is not a public
-- analytics endpoint.
-- ---------------------------------------------------------------------------
create or replace function recruiter_site_stats(p_days int default 28)
returns table (
  day date,
  visits bigint,
  unique_visitors bigint,
  searches bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  select s.day, s.visits, s.unique_visitors, s.searches
    from site_stats_daily s
   where exists (
           select 1 from recruiters r
            where r.user_id = auth.uid() and r.status = 'active'
         )
     and s.day >= current_date - greatest(1, least(coalesce(p_days, 28), 365))
   order by s.day desc;
$fn$;

-- ---------------------------------------------------------------------------
-- recruiter_campaign_stats — one campaign, owner only.
--
-- The ownership test is inside the query, not a separate check the caller
-- could skip: a campaign belonging to somebody else simply produces no rows.
-- ---------------------------------------------------------------------------
create or replace function recruiter_campaign_stats(p_campaign_id uuid)
returns table (
  day date,
  impressions_home bigint,
  impressions_search bigint,
  card_views bigint,
  apply_clicks bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  select d.day, d.impressions_home, d.impressions_search, d.card_views, d.apply_clicks
    from campaign_stats_daily d
    join campaigns c on c.id = d.campaign_id
   where d.campaign_id = p_campaign_id
     and c.recruiter_id = auth.uid()
   order by d.day desc;
$fn$;

-- ---------------------------------------------------------------------------
-- recruiter_campaign_totals — the dashboard's main query: every campaign this
-- recruiter owns, with its running totals, in one round trip.
--
-- A left join, so a campaign with no impressions yet shows zeros rather than
-- vanishing from the list. That matters on day one of a campaign, when "my
-- listing is not in the table" and "my listing has had no views" look the same
-- to the person reading it.
-- ---------------------------------------------------------------------------
create or replace function recruiter_campaign_totals()
returns table (
  campaign_id uuid,
  status text,
  kind text,
  plan text,
  title_snapshot text,
  job_id uuid,
  days int,
  price_ils numeric,
  starts_at timestamptz,
  ends_at timestamptz,
  days_left int,
  impressions bigint,
  card_views bigint,
  apply_clicks bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    c.id, c.status, c.kind, c.plan, c.title_snapshot, c.job_id, c.days, c.price_ils,
    c.starts_at, c.ends_at,
    case
      when c.status <> 'live' or c.ends_at is null then null
      else greatest(0, ceil(extract(epoch from (c.ends_at - now())) / 86400.0)::int)
    end as days_left,
    coalesce(sum(d.impressions_home + d.impressions_search), 0)::bigint as impressions,
    coalesce(sum(d.card_views), 0)::bigint   as card_views,
    coalesce(sum(d.apply_clicks), 0)::bigint as apply_clicks
  from campaigns c
  left join campaign_stats_daily d on d.campaign_id = c.id
  where c.recruiter_id = auth.uid()
  group by c.id
  order by c.created_at desc;
$fn$;

grant execute on function recruiter_site_stats(int)      to authenticated;
grant execute on function recruiter_campaign_stats(uuid) to authenticated;
grant execute on function recruiter_campaign_totals()    to authenticated;
