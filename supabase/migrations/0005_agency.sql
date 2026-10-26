-- 0005_agency.sql
-- Jobsworm - agency (reverse recruiting) and referrer tables.
-- PLAN.md section 9.5 (agency product), 9.6 (referrers), 10 (pricing).
-- The agency product launches post-MVP; these tables exist from day one so the
-- releases audit log and the consent model have somewhere to point.

-- ---------------------------------------------------------------------------
-- agencies
-- ---------------------------------------------------------------------------
create table agencies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  -- License number is collected but NOT gated on (PLAN.md 9.5).
  license_number text,
  website        text,
  contact_email  text,
  plan           text not null default 'payg' check (plan in ('payg', 'team', 'agency')),
  status         text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'churned')),
  -- Spammy agencies get throttled by this (PLAN.md 9.5).
  quality_score  real not null default 1.0,
  intros_included int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger agencies_set_updated_at
  before update on agencies
  for each row execute function public.set_updated_at();

comment on table agencies is
  'Licensed recruiting agencies. Revenue side of the product: they pay per accepted, double-opt-in intro (PLAN.md section 10).';

-- ---------------------------------------------------------------------------
-- agency_users - separate from seeker auth surface
-- ---------------------------------------------------------------------------
create table agency_users (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references agencies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'admin', 'member')),
  email      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_users_agency_user_unique unique (agency_id, user_id)
);

create trigger agency_users_set_updated_at
  before update on agency_users
  for each row execute function public.set_updated_at();

create index agency_users_user_id_idx on agency_users (user_id);

-- ---------------------------------------------------------------------------
-- agency_roles - a role an agency is recruiting for
-- ---------------------------------------------------------------------------
create table agency_roles (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies(id) on delete cascade,
  title       text,
  -- Pasted JD, or derived from a job in our index, or from the client's
  -- careers link (PLAN.md 9.5).
  jd_text     text,
  job_id      uuid references jobs(id) on delete set null,
  client_url  text,
  embedding   vector(1024),
  -- {seniority[], regions[], salary_max, functions[], skills[]}
  filters     jsonb not null default '{}'::jsonb,
  status      text not null default 'draft' check (status in ('draft', 'open', 'paused', 'closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger agency_roles_set_updated_at
  before update on agency_roles
  for each row execute function public.set_updated_at();

create index agency_roles_agency_id_status_idx on agency_roles (agency_id, status);

-- ---------------------------------------------------------------------------
-- intros - the double opt-in state machine (PLAN.md 9.5)
-- ---------------------------------------------------------------------------
create table intros (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies(id) on delete cascade,
  role_id        uuid not null references agency_roles(id) on delete cascade,
  profile_id     uuid not null references profiles(user_id) on delete cascade,
  state          intro_state not null default 'requested',
  requested_at   timestamptz not null default now(),
  responded_at   timestamptz,
  released_at    timestamptz,
  expires_at     timestamptz not null default (now() + interval '14 days'),
  decline_reason text,
  -- Charged only on acceptance (PLAN.md section 10).
  price_ils      numeric(10, 2),
  invoiced_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint intros_role_profile_unique unique (role_id, profile_id)
);

create trigger intros_set_updated_at
  before update on intros
  for each row execute function public.set_updated_at();

create index intros_profile_id_state_idx on intros (profile_id, state);
create index intros_agency_id_state_idx on intros (agency_id, state);

comment on table intros is
  'Double opt-in intro. The agency sees an anonymized card; CV and contact are released ONLY after the seeker accepts, and every release is written to releases (PLAN.md 9.5, 12).';

-- ---------------------------------------------------------------------------
-- referrers - anonymous, unpaid (PLAN.md 9.6)
-- ---------------------------------------------------------------------------
create table referrers (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  company_id        uuid not null references companies(id) on delete cascade,
  departments       text[] not null default '{}',
  verification_id   uuid references employment_verifications(id) on delete set null,
  verified_at       timestamptz,
  active            boolean not null default true,
  paused_until      timestamptz,
  -- Cap: <= 5 accepted referrals per week (PLAN.md 9.6).
  accepted_this_week int not null default 0,
  week_reset_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint referrers_user_company_unique unique (user_id, company_id)
);

create trigger referrers_set_updated_at
  before update on referrers
  for each row execute function public.set_updated_at();

create index referrers_company_id_active_idx on referrers (company_id) where active;

comment on table referrers is
  'Verified employees who accept referral requests. ANONYMOUS to seekers (badge only, never a name) and UNPAID - no money moves through the platform (PLAN.md 9.6).';

-- ---------------------------------------------------------------------------
-- referral_requests
-- ---------------------------------------------------------------------------
create table referral_requests (
  id             uuid primary key default gen_random_uuid(),
  referrer_id    uuid not null references referrers(id) on delete cascade,
  seeker_user_id uuid not null references auth.users(id) on delete cascade,
  job_id         uuid references jobs(id) on delete set null,
  company_id     uuid references companies(id) on delete set null,
  state          text not null default 'requested'
                 check (state in ('requested', 'accepted', 'declined', 'submitted', 'expired')),
  -- Per-request micro-consent (PLAN.md 9.6).
  consent_id     uuid references consents(id) on delete set null,
  outcome        text,
  requested_at   timestamptz not null default now(),
  responded_at   timestamptz,
  expires_at     timestamptz not null default (now() + interval '14 days'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger referral_requests_set_updated_at
  before update on referral_requests
  for each row execute function public.set_updated_at();

create index referral_requests_referrer_id_state_idx on referral_requests (referrer_id, state);
create index referral_requests_seeker_user_id_idx on referral_requests (seeker_user_id);

comment on table referral_requests is
  'Seeker -> anonymous referrer request. Caps: seeker <= 3 requests/week, referrer <= 5 accepted/week (PLAN.md 9.6).';
