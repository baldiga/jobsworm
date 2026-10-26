-- 0034_placement.sql — paid, labelled placement for employers and agencies.
--
-- ## The policy this schema exists to enforce
--
-- Sponsored is a SEPARATE, LABELLED SURFACE. It is never a ranking input.
--
-- Not one line of `search_jobs`, `search_jobs_count`, `search_facet_rows`,
-- `search_facets`, `match_jobs_for_me` or `company_jobs` is touched by this
-- migration, and that is the point: organic results cannot be bought because
-- the code that produces them cannot see who paid. Sponsored cards come from
-- `sponsored_jobs()`, a different function, rendered in a different place,
-- with the price printed on the card.
--
-- Agencies may buy sponsored slots and may not appear organically. The
-- `is_agency = false` predicate that every organic function already carries is
-- what enforces that, so again: nothing to change, and nothing that can be
-- forgotten later.
--
-- ## RLS: on, with zero policies
--
-- Same pattern as the agency tables in 0007. Every read goes through a
-- SECURITY DEFINER RPC that checks `auth.uid()`; every write goes through the
-- service role. A table with RLS on and no policies denies everything to a
-- browser, which is the correct default for tables holding money.

-- ---------------------------------------------------------------------------
-- price_ils — the SQL twin of priceIls() in packages/core/src/pricing.ts.
--
-- ₪19 a day; each successive week costs 10% less than the one before, and a
-- partial final week is pro-rated at THAT week's rate. Both implementations
-- round exactly once, at the end. The assertions below run on every
-- `db reset`, so the two cannot drift apart unnoticed.
-- ---------------------------------------------------------------------------
create or replace function price_ils(p_days int)
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
      from (values (1, 133::numeric), (2, 120::numeric),
                   (3, 108::numeric), (4, 97::numeric)) as w(i, total)
      where p_days > (w.i - 1) * 7
    ))
  end;
$fn$;

comment on function price_ils(int) is
  'Sponsored placement price in shekels, VAT inclusive. Mirrors priceIls() in @jobsworm/core; kept honest by the assertions in 0034.';

do $assert$
begin
  assert price_ils(1)  = 19,  'price_ils(1) should be 19, got '  || price_ils(1);
  assert price_ils(7)  = 133, 'price_ils(7) should be 133, got ' || price_ils(7);
  assert price_ils(10) = 184, 'price_ils(10) should be 184, got '|| price_ils(10);
  assert price_ils(14) = 253, 'price_ils(14) should be 253, got '|| price_ils(14);
  assert price_ils(21) = 361, 'price_ils(21) should be 361, got '|| price_ils(21);
  assert price_ils(28) = 458, 'price_ils(28) should be 458, got '|| price_ils(28);
  assert price_ils(0)  is null, 'price_ils(0) should be null';
  assert price_ils(29) is null, 'price_ils(29) should be null';
end
$assert$;

-- ---------------------------------------------------------------------------
-- recruiters — one row per person who buys placement.
--
-- ONE table for both kinds (D7). An employer points at a `companies` row, an
-- agency at the `agencies` row from 0005 — the same row that the reverse-
-- recruiting product will use when it launches, and the same row that
-- `profiles.excluded_agencies` already points at, so a seeker who has excluded
-- an agency has excluded it everywhere.
-- ---------------------------------------------------------------------------
create table recruiters (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('employer', 'agency')),
  company_id    uuid references companies(id) on delete set null,
  agency_id     uuid references agencies(id) on delete set null,
  org_name      text not null,
  website       text,
  contact_email text not null,
  -- Generated, so it cannot fall out of step with the address. Used to match
  -- an employer to their `companies` row and to refuse freemail signups.
  email_domain  text generated always as (
    lower(split_part(contact_email, '@', 2))
  ) stored,
  status        text not null default 'pending'
                check (status in ('pending', 'active', 'blocked')),
  verified_at   timestamptz,
  admin_notes   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- An agency must have an agency row; an employer must not. Without this,
  -- `is_agency` on a job could disagree with who actually bought it.
  constraint recruiters_kind_target check (
    (kind = 'employer' and agency_id is null) or
    (kind = 'agency'   and agency_id is not null)
  )
);

create trigger recruiters_set_updated_at
  before update on recruiters
  for each row execute function public.set_updated_at();

create index recruiters_company_id_idx on recruiters (company_id);
create index recruiters_agency_id_idx  on recruiters (agency_id);

comment on table recruiters is
  'Employers and agencies who buy labelled placement. Agencies reuse the 0005 agencies row so exclusions and the future intro product point at the same entity.';

-- ---------------------------------------------------------------------------
-- campaigns — one purchase of placement for one job.
--
-- ## The status machine
--
--   draft -> pending_review -> approved | rejected
--   approved + paid          -> live          (whichever arrives second)
--   live                     -> ended | refunded
--   draft | pending_review   -> cancelled     (buyer, unpaid only)
--
-- Approval and payment are independent and can arrive in either order:
-- somebody may pay before the review finishes, and an admin may approve before the
-- invoice is settled. `activate_campaign` is called after both and is a no-op
-- until both are true, so neither path needs to know about the other.
--
-- The job CLOSES when the campaign ends (D8). Renewing makes a new campaign,
-- which keeps "what was this listing paid for" answerable forever.
-- ---------------------------------------------------------------------------
create table campaigns (
  id                 uuid primary key default gen_random_uuid(),
  recruiter_id       uuid not null references recruiters(user_id) on delete cascade,
  kind               text not null check (kind in ('employer', 'agency')),
  /*
   * Free or paid, and it decides almost everything downstream.
   *
   *   free       7 days, organic only, no sponsored slot, no human review,
   *              no payment. The automated gates in posting.ts are the whole
   *              admissions test.
   *   sponsored  7/14/21/28 days, reviewed by a person, paid for, and shown
   *              in the labelled Sponsored surface.
   */
  plan               text not null default 'sponsored'
                     check (plan in ('free', 'sponsored')),
  buyer_name         text,
  -- One campaign per job. A second purchase for the same role is a new job row
  -- as well as a new campaign, which is what keeps the price on the card true.
  job_id             uuid unique references jobs(id) on delete set null,
  title_snapshot     text,
  -- The submitted form, kept verbatim. If decomposition changes, this is what
  -- the buyer actually asked for.
  form               jsonb not null default '{}'::jsonb,

  days               int not null check (days between 1 and 28),
  -- Zero for a free listing. `not null` because "we do not know what this
  -- cost" must never be a state a campaign can be in.
  price_ils          numeric(10,2) not null,
  price_per_day_ils  numeric(10,2),

  status             text not null default 'draft' check (status in (
                       'draft', 'pending_review', 'approved', 'live',
                       'ended', 'rejected', 'refunded', 'cancelled')),
  submitted_at       timestamptz,
  approved_at        timestamptz,
  approved_by        uuid references auth.users(id) on delete set null,
  rejection_reason   text,

  paid_at            timestamptz,
  payment_provider   text check (payment_provider in ('greeninvoice', 'fungies')),
  payment_ref        text,
  paid_amount        numeric(10,2),
  paid_currency      text,

  starts_at          timestamptz,
  ends_at            timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Idempotency at the schema level, not just in the webhook handler: the same
  -- provider reference can never mark two campaigns paid.
  constraint campaigns_payment_ref_unique unique (payment_provider, payment_ref),

  /*
   * Free posting is for EMPLOYERS ONLY (D3).
   *
   * Organic search is agency-free — that is a promise made on the home page,
   * in the terms and on every agency job page, and it is enforced by the
   * `is_agency = false` predicate in every organic search function. A free
   * listing is an organic listing, so an agency buying one would be the one
   * route around that promise. It is refused in the form, in the API route,
   * and here, because the third one is the only one that cannot be bypassed.
   */
  constraint campaigns_free_is_employer check (
    plan = 'sponsored' or kind = 'employer'
  ),

  -- A free campaign is a week and costs nothing. Stating it here means no
  -- code path can quietly sell, or quietly extend, a free listing.
  constraint campaigns_free_terms check (
    plan = 'sponsored' or (days = 7 and price_ils = 0)
  )
);

create trigger campaigns_set_updated_at
  before update on campaigns
  for each row execute function public.set_updated_at();

create index campaigns_recruiter_idx on campaigns (recruiter_id, created_at desc);
create index campaigns_status_idx    on campaigns (status);
create index campaigns_ends_at_idx   on campaigns (ends_at) where status = 'live';

-- ---------------------------------------------------------------------------
-- payment_events — every webhook the provider ever sent, once.
--
-- The primary key IS the provider's own event id, so a replay conflicts on
-- insert and the handler can answer 200 without doing the work twice. Payment
-- providers retry aggressively and duplicate delivery is normal, not an edge
-- case.
-- ---------------------------------------------------------------------------
create table payment_events (
  provider    text not null,
  event_id    text not null,
  event_type  text,
  campaign_id uuid references campaigns(id) on delete set null,
  payload     jsonb not null default '{}'::jsonb,
  processed   boolean not null default false,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create index payment_events_unprocessed_idx
  on payment_events (received_at desc) where processed = false;

-- ---------------------------------------------------------------------------
-- pending_checkouts — the fallback for matching a payment to a campaign.
--
-- Hosted checkout is supposed to carry the campaign id back in a custom field.
-- When it does not — a buyer who reached the payment page some other way, a
-- field that silently did not pre-fill — this row lets the webhook match on
-- email and amount instead of dropping the payment on the floor.
-- ---------------------------------------------------------------------------
create table pending_checkouts (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  provider    text not null,
  buyer_email text,
  amount      numeric(10,2),
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index pending_checkouts_open_idx
  on pending_checkouts (buyer_email, created_at desc) where consumed_at is null;

alter table recruiters        enable row level security;
alter table campaigns         enable row level security;
alter table payment_events    enable row level security;
alter table pending_checkouts enable row level security;
-- Deliberately no policies. See the header.

-- ---------------------------------------------------------------------------
-- jobs: what a sponsored listing carries.
--
-- The price and the day count are stored ON THE JOB, not only on the campaign,
-- because the card prints them and a card render should not join to a money
-- table. They are also a record: "employer paid ₪253" stays true even if the
-- campaign is later refunded and the numbers there change.
-- ---------------------------------------------------------------------------
/*
 * `total_comp` is separate from `salary` on purpose.
 *
 * `salary` is monthly gross base in shekels, and it is required on everything
 * posted through Jobsworm. Total compensation is optional, usually annual, and
 * usually includes equity nobody can value at the point of reading. Folding
 * the two together is exactly how a base of 25,000 gets advertised as 40,000,
 * so they are two columns and the page prints them as two figures.
 *
 * `benefits text[]` already exists (0003) and holds the checkbox keys from
 * packages/core/src/compensation.ts. No new column needed for those.
 */
alter table jobs
  add column if not exists total_comp            jsonb,
  add column if not exists posted_by             uuid references auth.users(id) on delete set null,
  add column if not exists sponsored_campaign_id uuid references campaigns(id) on delete set null,
  add column if not exists sponsored_until       timestamptz,
  add column if not exists sponsored_days        int,
  add column if not exists sponsored_price_ils   numeric(10,2);

-- Partial: sponsored jobs are a handful of rows in an index of thousands.
create index if not exists jobs_sponsored_live_idx
  on jobs (sponsored_until desc) where sponsored_until is not null;

comment on column jobs.sponsored_price_ils is
  'What was actually paid, in shekels. Printed on the card: the buyer chose transparency, so the reader gets it too.';

-- ---------------------------------------------------------------------------
-- sponsored_jobs — the paid surface.
--
-- Deliberately NOT filtered by `is_agency`: this is the one place an agency
-- listing may appear, and it appears labelled as one.
--
-- Relevance uses the same title/skills test as `search_jobs` so a sponsored
-- card on a search page is at least about what was searched for. Ordering is
-- `rank desc, random()` — among equally relevant advertisers nobody is
-- permanently first.
-- ---------------------------------------------------------------------------
create or replace function sponsored_jobs(
  q         text default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit   int default 3
)
returns table (
  id uuid,
  company_id uuid,
  title_raw text,
  title_norm text,
  "function" job_function,
  sub_function text,
  seniority seniority_level,
  employment_type employment_type,
  remote remote_mode,
  hybrid_days_office int,
  location jsonb,
  skills_required text[],
  skills_nice text[],
  tech_stack text[],
  languages jsonb,
  education education_level,
  clearance boolean,
  salary jsonb,
  salary_estimate jsonb,
  excerpt text,
  apply_url text,
  apply_method apply_method,
  source_provider text,
  source_url text,
  lang job_lang,
  is_agency boolean,
  company_hidden boolean,
  quality_flags text[],
  posted_at timestamptz,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  ghost_score int,
  status job_status,
  company_name text,
  company_slug text,
  company_domain text,
  rank real,
  sponsored_campaign_id uuid,
  sponsored_price_ils numeric,
  sponsored_days int,
  sponsored_until timestamptz,
  sponsored_kind text
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
    case
      when normalize_he(q) is null then null
      else websearch_to_tsquery('simple', normalize_he(q))
    end as query
),
live as (
  select
    j.id,
    (
      case
        when t.query is null then 0::real
        when j.search_tsv @@ t.query then ts_rank_cd(j.search_tsv, t.query)
        else 0::real
      end
    )::real as rank
  from jobs j
  cross join tsq t
  where j.status = 'open'
    and j.sponsored_until is not null
    and j.sponsored_until > now()
    -- No is_agency predicate here, on purpose. See the header.
    and (
      t.query is null
      or (
           j.search_tsv @@ t.query
           and ts_rank_cd(array[0, 0, 0.4, 1.0], j.search_tsv, t.query) > 0
         )
      or (
           position(' or ' in t.norm_q) = 0
           and length(t.norm_q) <= 24
           and coalesce(j.title_norm, '') % t.norm_q
         )
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
  c.slug as company_slug,
  c.domain as company_domain,
  l.rank,
  j.sponsored_campaign_id,
  j.sponsored_price_ils,
  j.sponsored_days,
  j.sponsored_until,
  cp.kind as sponsored_kind
from live l
join jobs j on j.id = l.id
left join companies c on c.id = j.company_id
left join campaigns cp on cp.id = j.sponsored_campaign_id
order by l.rank desc, random()
limit greatest(1, least(coalesce(p_limit, 3), 5));
$fn$;

grant execute on function sponsored_jobs(text, jsonb, int) to anon, authenticated;

-- ===========================================================================
-- Service-role RPCs. Revoked from browsers: these move money and change what
-- the public sees.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- mark_campaign_paid — idempotent on `paid_at`, and again on the unique
-- (payment_provider, payment_ref). Returns the campaign's status afterwards.
-- ---------------------------------------------------------------------------
create or replace function mark_campaign_paid(
  p_campaign_id uuid,
  p_provider    text,
  p_ref         text,
  p_amount      numeric default null,
  p_currency    text default 'ILS'
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
         -- Qualified: `price_ils` is both a column here and a function above.
         paid_amount      = coalesce(p_amount, campaigns.price_ils),
         paid_currency    = coalesce(p_currency, 'ILS')
   where id = p_campaign_id;

  return activate_campaign(p_campaign_id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- approve_campaign — an admin has read the listing and it is a real, open tech
-- role in Israel.
--
-- Approval also promotes the buyer: an approved campaign is the evidence that
-- the recruiter, the agency and the company claim are all genuine, so this is
-- the natural place to flip those to active rather than a separate chore that
-- can be forgotten.
-- ---------------------------------------------------------------------------
create or replace function approve_campaign(p_campaign_id uuid, p_admin uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c campaigns;
  r recruiters;
begin
  select * into c from campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'campaign % not found', p_campaign_id;
  end if;
  if c.status in ('ended', 'refunded', 'cancelled') then
    return c.status;
  end if;

  update campaigns
     set status      = case when status = 'live' then 'live' else 'approved' end,
         approved_at = coalesce(approved_at, now()),
         approved_by = coalesce(p_admin, approved_by),
         rejection_reason = null
   where id = p_campaign_id;

  select * into r from recruiters where user_id = c.recruiter_id;
  if found then
    update recruiters
       set status = 'active', verified_at = coalesce(verified_at, now())
     where user_id = r.user_id;
    if r.agency_id is not null then
      update agencies set status = 'active' where id = r.agency_id and status = 'pending';
    end if;
    -- Only if unclaimed: approving an advert is not grounds for taking a
    -- company page away from whoever already holds it.
    if r.company_id is not null then
      update companies set claimed_by = r.user_id
       where id = r.company_id and claimed_by is null;
    end if;
  end if;

  return activate_campaign(p_campaign_id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- activate_campaign — go live, but only when approved AND paid.
--
-- Called from both `approve_campaign` and `mark_campaign_paid` without either
-- caring which came first. Idempotent: a second call on a live campaign does
-- nothing.
-- ---------------------------------------------------------------------------
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
  /*
   * A free listing needs neither. Its admissions test ran at submission, in
   * the automated gates, and there is nothing to pay for — so it goes live the
   * moment it is created and closes itself seven days later.
   *
   * A paid one needs BOTH, in either order, and this returns unchanged until
   * the second one arrives.
   */
  if c.plan <> 'free' and (c.approved_at is null or c.paid_at is null) then
    return c.status;
  end if;

  v_ends := now() + (c.days * interval '1 day');
  -- What the card prints is what the buyer actually paid, when that is a
  -- shekel amount. A foreign-currency settlement falls back to list price
  -- rather than printing dollars on a page that talks in shekels.
  v_price := case
               when c.paid_amount is not null and upper(coalesce(c.paid_currency, 'ILS')) = 'ILS'
                 then c.paid_amount
               else c.price_ils
             end;

  update campaigns
     set status    = 'live',
         starts_at = coalesce(starts_at, now()),
         ends_at   = v_ends
   where id = p_campaign_id;

  if c.job_id is not null then
    /*
     * `sponsored_*` is written ONLY for a paid campaign.
     *
     * That is what keeps a free listing out of `sponsored_jobs()` — which
     * selects on `sponsored_until > now()` — and off the card as a Sponsored
     * chip. A free listing is an ordinary organic row that happens to have
     * been typed by the employer rather than scraped from them.
     *
     * `expires_at` is set for BOTH, to the campaign's end. For a free listing
     * that is the seven-day ghost-job limit; for a paid one it means the
     * ordinary hourly expiry sweep closes it even if the campaign cron is
     * somehow not running.
     */
    update jobs
       set status                = 'open',
           sponsored_campaign_id = case when c.plan = 'free' then null else c.id end,
           sponsored_until       = case when c.plan = 'free' then null else v_ends end,
           sponsored_days        = case when c.plan = 'free' then null else c.days end,
           sponsored_price_ils   = case when c.plan = 'free' then null else v_price end,
           expires_at            = v_ends,
           posted_at             = coalesce(posted_at, now()),
           last_seen_at          = now()
     where id = c.job_id;
  end if;

  return 'live';
end;
$fn$;

create or replace function reject_campaign(
  p_campaign_id uuid,
  p_reason      text,
  p_admin       uuid default null
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
  if not found then raise exception 'campaign % not found', p_campaign_id; end if;

  update campaigns
     set status = 'rejected', rejection_reason = p_reason, approved_by = p_admin
   where id = p_campaign_id;

  -- A rejected listing must not be reachable, including by anyone holding its
  -- URL from the preview.
  if c.job_id is not null then
    update jobs set status = 'draft', sponsored_until = null where id = c.job_id;
  end if;

  return 'rejected';
end;
$fn$;

-- Refund closes the listing immediately. A refused listing gets its money
-- back in full; days already served are not refunded, which is a decision the
-- terms state and a human makes — this function only records the outcome.
create or replace function refund_campaign(p_campaign_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c campaigns;
begin
  select * into c from campaigns where id = p_campaign_id for update;
  if not found then raise exception 'campaign % not found', p_campaign_id; end if;

  update campaigns set status = 'refunded', ends_at = now() where id = p_campaign_id;

  if c.job_id is not null then
    update jobs
       set status = 'closed', closed_at = now(), sponsored_until = null
     where id = c.job_id;
  end if;

  return 'refunded';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- end_expired_campaigns — the campaign is over, so the listing closes (D8).
-- Bounded like expire_stale_jobs for the same reason.
-- ---------------------------------------------------------------------------
create or replace function end_expired_campaigns(p_limit int default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  affected integer;
begin
  with due as (
    select c.id, c.job_id
      from campaigns c
     where c.status = 'live'
       and c.ends_at is not null
       and c.ends_at < now()
     order by c.ends_at
     limit greatest(1, coalesce(p_limit, 200))
     for update skip locked
  ),
  closed_jobs as (
    update jobs j
       set status = 'closed', closed_at = now(), sponsored_until = null
      from due
     where j.id = due.job_id and j.status = 'open'
     returning j.id
  )
  update campaigns c
     set status = 'ended'
    from due
   where c.id = due.id;

  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- end_campaign_now — stop one campaign immediately, without a refund.
--
-- For the listing whose role was filled on day three, and for the free listing
-- that should not have gone up. Distinct from `refund_campaign`, which is a
-- money decision, and from `end_expired_campaigns`, which is the clock.
-- ---------------------------------------------------------------------------
create or replace function end_campaign_now(p_campaign_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c campaigns;
begin
  select * into c from campaigns where id = p_campaign_id for update;
  if not found then raise exception 'campaign % not found', p_campaign_id; end if;

  update campaigns set status = 'ended', ends_at = now() where id = p_campaign_id;

  if c.job_id is not null then
    update jobs
       set status = 'closed', closed_at = now(), sponsored_until = null
     where id = c.job_id;
  end if;

  return 'ended';
end;
$fn$;

revoke execute on function end_campaign_now(uuid) from anon, authenticated;
revoke execute on function mark_campaign_paid(uuid, text, text, numeric, text) from anon, authenticated;
revoke execute on function approve_campaign(uuid, uuid)   from anon, authenticated;
revoke execute on function activate_campaign(uuid)        from anon, authenticated;
revoke execute on function reject_campaign(uuid, text, uuid) from anon, authenticated;
revoke execute on function refund_campaign(uuid)          from anon, authenticated;
revoke execute on function end_expired_campaigns(int)     from anon, authenticated;

-- ===========================================================================
-- Recruiter-facing RPCs. Every one of them is scoped by auth.uid(): a
-- recruiter can reach their own rows and no others, and that is enforced here
-- rather than in a query string the browser controls.
-- ===========================================================================

create or replace function recruiter_me()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select case when r.user_id is null then null else jsonb_build_object(
    'user_id', r.user_id,
    'kind', r.kind,
    'org_name', r.org_name,
    'website', r.website,
    'contact_email', r.contact_email,
    'status', r.status,
    'company_id', r.company_id,
    'agency_id', r.agency_id,
    'verified_at', r.verified_at
  ) end
  from (select * from recruiters where user_id = auth.uid()) r;
$fn$;

create or replace function recruiter_my_campaigns()
returns table (
  id uuid,
  kind text,
  plan text,
  status text,
  title_snapshot text,
  job_id uuid,
  days int,
  price_ils numeric,
  paid_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  days_left int,
  rejection_reason text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    c.id, c.kind, c.plan, c.status, c.title_snapshot, c.job_id, c.days, c.price_ils,
    c.paid_at, c.starts_at, c.ends_at,
    case
      when c.status <> 'live' or c.ends_at is null then null
      else greatest(0, ceil(extract(epoch from (c.ends_at - now())) / 86400.0)::int)
    end as days_left,
    c.rejection_reason,
    c.created_at
  from campaigns c
  where c.recruiter_id = auth.uid()
  order by c.created_at desc;
$fn$;

-- Cancelling is for a campaign that has not been paid for. Once money has
-- changed hands the buyer talks to a person, because a refund is a decision
-- and not a button.
create or replace function cancel_my_campaign(p_campaign_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c campaigns;
begin
  select * into c from campaigns
   where id = p_campaign_id and recruiter_id = auth.uid()
   for update;
  if not found then
    raise exception 'campaign not found';  -- deliberately the same error as
                                           -- somebody else's campaign
  end if;
  if c.paid_at is not null then
    raise exception 'a paid campaign cannot be cancelled here';
  end if;

  update campaigns set status = 'cancelled' where id = c.id;
  if c.job_id is not null then
    update jobs set status = 'draft', sponsored_until = null where id = c.job_id;
  end if;
  return 'cancelled';
end;
$fn$;

grant execute on function recruiter_me()                to authenticated;
grant execute on function recruiter_my_campaigns()      to authenticated;
grant execute on function cancel_my_campaign(uuid)      to authenticated;

-- ---------------------------------------------------------------------------
-- recruiter_free_quota — how many free listings this account may still post.
--
-- Free posting with no human in the loop is the obvious abuse route: a fake
-- vacancy is the cheapest way to collect CVs, and "free and instant" is what
-- makes it worth doing at scale. The automated gates decide whether ONE
-- listing looks real; this decides how many a stranger may put up before
-- somebody has looked at them.
--
-- Two limits, doing different jobs. `live` caps how much of the index one
-- unreviewed account can occupy at any moment. `week` caps churn, so the cap
-- cannot be farmed by posting and deleting.
--
-- Generous on purpose: a real company hiring for four roles at once is
-- ordinary, and the numbers below are not meant to inconvenience them.
-- ---------------------------------------------------------------------------
create or replace function recruiter_free_quota()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'live_used',  (select count(*) from campaigns
                    where recruiter_id = auth.uid() and plan = 'free' and status = 'live'),
    'live_limit', 4,
    'week_used',  (select count(*) from campaigns
                    where recruiter_id = auth.uid() and plan = 'free'
                      and created_at > now() - interval '7 days'),
    'week_limit', 8
  );
$fn$;

grant execute on function recruiter_free_quota() to authenticated;

/*
 * The same figures for one named account, for the service role.
 *
 * The API route that enforces the quota writes with the service role, which
 * has no session and therefore no `auth.uid()` — so it cannot call the
 * function above. Two functions rather than one with an optional argument,
 * because an optional `p_user` on a function granted to `authenticated` is a
 * function any signed-in user can point at anyone else's account.
 */
create or replace function recruiter_free_quota_for(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'live_used',  (select count(*) from campaigns
                    where recruiter_id = p_user and plan = 'free' and status = 'live'),
    'live_limit', 4,
    'week_used',  (select count(*) from campaigns
                    where recruiter_id = p_user and plan = 'free'
                      and created_at > now() - interval '7 days'),
    'week_limit', 8
  );
$fn$;

revoke execute on function recruiter_free_quota_for(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The dedupe guard.
--
-- `dedupe_open_jobs` ranks ATS rows above everything else, so an employer who
-- pays for a listing that also exists on their own Greenhouse feed would have
-- the PAID one closed as a duplicate that night. They would have bought
-- nothing, silently, and the first anyone would know is the refund request.
--
-- Body is 0037's verbatim apart from the extra predicate.
-- ---------------------------------------------------------------------------
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
          case
            when j.source_provider in (
              'comeet','greenhouse','lever','ashby','workable',
              'smartrecruiters','recruitee','workday','personio','bamboohr'
            ) then 0
            when j.source_provider in ('drushim','alljobs','yad2') then 1
            else 2
          end,
          j.last_seen_at desc nulls last,
          coalesce(j.posted_at, j.first_seen_at) desc nulls last,
          j.id
      ) as rn
    from jobs j
    where j.status = 'open'
      and j.fingerprint is not null
      -- A live sponsored listing is never a duplicate to be closed. It is not
      -- excluded from `ranked` entirely, because then a paid row could not
      -- displace the free copy either; it simply cannot be the loser.
      and (j.sponsored_until is null or j.sponsored_until < now())
  ),
  losers as (
    select r.id from ranked r where r.rn > 1
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
