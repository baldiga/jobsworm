-- 0045_price_in_usd.sql — the money is dollars, so the columns say dollars.
--
-- ## Why this is a rename and not a reinterpretation
--
-- The payment provider settles in USD; every offer in the fungies account is
-- USD. Leaving a column called `price_ils` holding dollars would be the most
-- expensive kind of comment rot: every future reader, and every future query,
-- would be told the wrong unit by the schema itself. A column name is a claim
-- about what is in it.
--
-- Safe to do as a rename because exactly one campaign exists and it has never
-- been paid for. It is converted below at the same 3.2 the display uses, so
-- the one row on the system keeps meaning what it meant.
--
-- ## The rate is for READING, not for charging
--
-- ₪ figures shown next to a price are `usd × 3.2`, fixed. Nothing is ever
-- charged in shekels, so nothing depends on that rate being current — and a
-- fixed number is one nobody has to keep checking. A live rate would make the
-- figure on the pricing page differ from the one on the listing a week later,
-- for a number whose whole job is to help an Israeli reader size the cost.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table campaigns rename column price_ils to price_usd;
alter table campaigns rename column price_per_day_ils to price_per_day_usd;
alter table jobs      rename column sponsored_price_ils to sponsored_price_usd;

comment on column jobs.sponsored_price_usd is
  'What was actually paid, in US dollars. Printed on the card: the buyer chose transparency, so the reader gets it too.';

-- The one existing campaign was priced in shekels. Convert rather than leave a
-- row whose number means something different from every row after it.
update campaigns
   set price_usd = round(price_usd / 3.2),
       price_per_day_usd = case
                             when days > 0 then round((price_usd / 3.2) / days, 2)
                             else price_per_day_usd
                           end
 where paid_at is null
   and price_usd > 200;   -- only the shekel-scale figures; a dollar price is far smaller

update campaigns set paid_currency = 'USD' where paid_currency is null or paid_currency = 'ILS';

-- ---------------------------------------------------------------------------
-- price_usd(days) — the SQL twin of priceUsd() in packages/core/src/pricing.ts
--
-- $6 a day; each successive week 10% less than the one before, and a partial
-- final week pro-rated at THAT week's rate. Both implementations round exactly
-- once, at the end. The assertions run on every `db reset`.
-- ---------------------------------------------------------------------------
drop function if exists price_ils(int);

create or replace function price_usd(p_days int)
returns numeric
language sql
immutable
as $fn$
  select case
    when p_days is null or p_days < 1 or p_days > 28 then null
    else round((
      select sum(
        case
          when least(7, p_days - (w.i - 1) * 7) = 7 then w.total
          else w.total * least(7, p_days - (w.i - 1) * 7) / 7.0
        end
      )
      from (values (1, 42::numeric), (2, 38::numeric),
                   (3, 34::numeric), (4, 31::numeric)) as w(i, total)
      where p_days > (w.i - 1) * 7
    ))
  end;
$fn$;

comment on function price_usd(int) is
  'Sponsored placement price in US dollars. Mirrors priceUsd() in @jobsworm/core; kept honest by the assertions in 0045.';

do $assert$
begin
  assert price_usd(1)  = 6,   'price_usd(1) should be 6, got '   || price_usd(1);
  assert price_usd(7)  = 42,  'price_usd(7) should be 42, got '  || price_usd(7);
  assert price_usd(10) = 58,  'price_usd(10) should be 58, got ' || price_usd(10);
  assert price_usd(14) = 80,  'price_usd(14) should be 80, got ' || price_usd(14);
  assert price_usd(21) = 114, 'price_usd(21) should be 114, got '|| price_usd(21);
  assert price_usd(28) = 145, 'price_usd(28) should be 145, got '|| price_usd(28);
  assert price_usd(0)  is null, 'price_usd(0) should be null';
  assert price_usd(29) is null, 'price_usd(29) should be null';
end
$assert$;

-- ---------------------------------------------------------------------------
-- The free-tier constraint referenced the old column name.
-- ---------------------------------------------------------------------------
alter table campaigns drop constraint if exists campaigns_free_terms;
alter table campaigns add constraint campaigns_free_terms check (
  plan = 'sponsored' or (days = 7 and price_usd = 0)
);

-- ---------------------------------------------------------------------------
-- Every function that named the old column.
-- ---------------------------------------------------------------------------
create or replace function mark_campaign_paid(
  p_campaign_id uuid,
  p_provider    text,
  p_ref         text,
  p_amount      numeric default null,
  p_currency    text default 'USD'
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c campaigns;
begin
  select * into c from campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'campaign % not found', p_campaign_id;
  end if;
  if c.paid_at is not null then
    return c.status;  -- already paid; a retried webhook must not double-book
  end if;

  update campaigns
     set paid_at          = now(),
         payment_provider = p_provider,
         payment_ref      = p_ref,
         -- Qualified: `price_usd` is both a column here and a function above.
         paid_amount      = coalesce(p_amount, campaigns.price_usd),
         paid_currency    = coalesce(p_currency, 'USD')
   where id = p_campaign_id;

  return activate_campaign(p_campaign_id);
end;
$fn$;

revoke execute on function mark_campaign_paid(uuid, text, text, numeric, text) from anon, authenticated;

create or replace function activate_campaign(p_campaign_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c        campaigns;
  v_ends   timestamptz;
  v_price  numeric(10,2);
begin
  select * into c from campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'campaign % not found', p_campaign_id;
  end if;
  if c.status = 'live' then return 'live'; end if;
  if c.plan <> 'free' and (c.approved_at is null or c.paid_at is null) then
    return c.status;
  end if;

  v_ends := now() + (c.days * interval '1 day');
  -- What the card prints is what the buyer actually paid, when that is a
  -- dollar amount. A foreign-currency settlement falls back to list price
  -- rather than printing the wrong symbol.
  v_price := case
               when c.paid_amount is not null and upper(coalesce(c.paid_currency, 'USD')) = 'USD'
                 then c.paid_amount
               else c.price_usd
             end;

  update campaigns
     set status    = 'live',
         starts_at = coalesce(starts_at, now()),
         ends_at   = v_ends
   where id = p_campaign_id;

  if c.job_id is not null then
    update jobs
       set status                = 'open',
           sponsored_campaign_id = case when c.plan = 'free' then null else c.id end,
           sponsored_until       = case when c.plan = 'free' then null else v_ends end,
           sponsored_days        = case when c.plan = 'free' then null else c.days end,
           sponsored_price_usd   = case when c.plan = 'free' then null else v_price end,
           expires_at            = v_ends,
           posted_at             = coalesce(posted_at, now()),
           last_seen_at          = now()
     where id = c.job_id;
  end if;

  return 'live';
end;
$fn$;

revoke execute on function activate_campaign(uuid) from anon, authenticated;

-- sponsored_jobs returns the column, so its signature changes.
drop function if exists sponsored_jobs(text, jsonb, int);

create or replace function sponsored_jobs(
  q         text default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit   int default 3
)
returns table (
  id uuid, company_id uuid, title_raw text, title_norm text,
  "function" job_function, sub_function text, seniority seniority_level,
  employment_type employment_type, remote remote_mode, hybrid_days_office int,
  location jsonb, skills_required text[], skills_nice text[], tech_stack text[],
  languages jsonb, education education_level, clearance boolean, salary jsonb,
  salary_estimate jsonb, excerpt text, apply_url text, apply_method apply_method,
  source_provider text, source_url text, lang job_lang, is_agency boolean,
  company_hidden boolean, quality_flags text[], posted_at timestamptz,
  first_seen_at timestamptz, last_seen_at timestamptz, ghost_score int,
  status job_status, company_name text, company_slug text, company_domain text,
  rank real, sponsored_campaign_id uuid, sponsored_price_usd numeric,
  sponsored_days int, sponsored_until timestamptz, sponsored_kind text
)
language sql
stable
security definer
set search_path = public
as $fn$
with tsq as (
  select
    normalize_he(q) as norm_q,
    coalesce(p_filters, '{}'::jsonb) as f,
    case when normalize_he(q) is null then null
         else websearch_to_tsquery('simple', normalize_he(q)) end as query
),
live as (
  select j.id,
    (case when t.query is null then 0::real
          when j.search_tsv @@ t.query then ts_rank_cd(j.search_tsv, t.query)
          else 0::real end)::real as rank
  from jobs j
  cross join tsq t
  where j.status = 'open'
    and j.sponsored_until is not null
    and j.sponsored_until > now()
    -- No is_agency predicate here, on purpose: this is the one surface where
    -- an agency listing may appear, and it appears labelled as one.
    and (
      t.query is null
      or (j.search_tsv @@ t.query
          and ts_rank_cd(array[0, 0, 0.4, 1.0], j.search_tsv, t.query) > 0)
      or (position(' or ' in t.norm_q) = 0
          and length(t.norm_q) <= 24
          and coalesce(j.title_norm, '') % t.norm_q)
    )
    and (t.f -> 'regions' is null
         or coalesce(j.location ->> 'region', '') in (
              select jsonb_array_elements_text(t.f -> 'regions')))
    and (t.f -> 'functions' is null
         or j."function"::text in (
              select jsonb_array_elements_text(t.f -> 'functions')))
    and (t.f -> 'seniority' is null
         or j.seniority::text in (
              select jsonb_array_elements_text(t.f -> 'seniority')))
    and (t.f -> 'remote' is null
         or j.remote::text in (
              select jsonb_array_elements_text(t.f -> 'remote')))
)
select
  j.id, j.company_id, j.title_raw, j.title_norm, j."function", j.sub_function,
  j.seniority, j.employment_type, j.remote, j.hybrid_days_office, j.location,
  j.skills_required, j.skills_nice, j.tech_stack, j.languages, j.education,
  j.clearance, j.salary, j.salary_estimate, j.excerpt, j.apply_url,
  j.apply_method, j.source_provider, j.source_url, j.lang, j.is_agency,
  j.company_hidden, j.quality_flags, j.posted_at, j.first_seen_at,
  j.last_seen_at, j.ghost_score, j.status,
  coalesce(c.name_en, c.name_he, j.company_name_raw) as company_name,
  c.slug, c.domain, l.rank,
  j.sponsored_campaign_id, j.sponsored_price_usd, j.sponsored_days,
  j.sponsored_until, cp.kind
from live l
join jobs j on j.id = l.id
left join companies c on c.id = j.company_id
left join campaigns cp on cp.id = j.sponsored_campaign_id
order by l.rank desc, random()
limit greatest(1, least(coalesce(p_limit, 3), 5));
$fn$;

grant execute on function sponsored_jobs(text, jsonb, int) to anon, authenticated;

-- Recruiter-facing reads return the renamed column.
drop function if exists recruiter_my_campaigns();

create or replace function recruiter_my_campaigns()
returns table (
  id uuid, kind text, plan text, status text, title_snapshot text, job_id uuid,
  days int, price_usd numeric, paid_at timestamptz, starts_at timestamptz,
  ends_at timestamptz, days_left int, rejection_reason text, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select c.id, c.kind, c.plan, c.status, c.title_snapshot, c.job_id, c.days,
         c.price_usd, c.paid_at, c.starts_at, c.ends_at,
         case when c.status <> 'live' or c.ends_at is null then null
              else greatest(0, ceil(extract(epoch from (c.ends_at - now())) / 86400.0)::int)
         end,
         c.rejection_reason, c.created_at
    from campaigns c
   where c.recruiter_id = auth.uid()
   order by c.created_at desc;
$fn$;

grant execute on function recruiter_my_campaigns() to authenticated;

drop function if exists recruiter_campaign_totals();

create or replace function recruiter_campaign_totals()
returns table (
  campaign_id uuid, status text, kind text, plan text, title_snapshot text,
  job_id uuid, days int, price_usd numeric, starts_at timestamptz,
  ends_at timestamptz, days_left int, impressions bigint, card_views bigint,
  apply_clicks bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  select c.id, c.status, c.kind, c.plan, c.title_snapshot, c.job_id, c.days,
         c.price_usd, c.starts_at, c.ends_at,
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
