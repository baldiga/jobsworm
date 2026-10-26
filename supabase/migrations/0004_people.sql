-- 0004_people.sql
-- Jobsworm - seeker-side tables.
-- PLAN.md section 3 "People tables", section 8 (profile & consent),
-- section 12 (Israel Privacy Protection Law, Amendment 13).
--
-- NEVER COLLECTED, here or anywhere else (PLAN.md section 3 / 12):
--   age or date of birth, gender, family status, health, religion,
--   army unit (only clearance yes/no/in_process), ID numbers, photos.
-- Do not add such a column in a later migration.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table profiles (
  user_id                    uuid primary key references auth.users(id) on delete cascade,
  name                       text,
  -- Collected ONLY when propose_me is on; released only after the seeker
  -- accepts a specific intro (PLAN.md section 8, Consent B).
  phone                      text,

  target_functions           job_function[] not null default '{}',
  seniority                  seniority_level,
  regions                    text[] not null default '{}',
  hybrid_tolerance           int check (hybrid_tolerance is null or (hybrid_tolerance >= 0 and hybrid_tolerance <= 7)),
  salary_floor_bucket        int,                              -- ILS 500 buckets
  employment_types           employment_type[] not null default '{}',
  languages                  jsonb not null default '{}'::jsonb,  -- {"hebrew":"required",...} (lang_req values)
  clearance                  clearance_status,
  situation                  situation_state,
  notice_period_days         int,
  available_from             date,
  -- Salted hash of the current employer's email domain. Used ONLY to exclude
  -- the current employer from intros - never to identify the employer.
  current_employer_domain_hash text,

  propose_me                 boolean not null default false,   -- Consent B toggle, default OFF
  paused_until               timestamptz,
  excluded_companies         uuid[] not null default '{}',
  excluded_agencies          uuid[] not null default '{}',

  cv_fresh_until             timestamptz,                      -- CV expires from matching after 90 days
  embedding                  vector(1024),

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function public.set_updated_at();

comment on table profiles is
  'Seeker profile. Owner-only RLS. Progressive: nothing beyond email at signup (PLAN.md 7.1).';
comment on column profiles.propose_me is
  'Consent B. Default OFF, checkbox never pre-checked. Turning it off removes the anonymized card within 1h (PLAN.md section 8).';
comment on column profiles.current_employer_domain_hash is
  'Salted hash, exclusion only. Never store the raw employer domain here.';

-- ---------------------------------------------------------------------------
-- resumes
-- ---------------------------------------------------------------------------
create table resumes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,                                  -- private bucket, 15-min signed URLs
  filename     text,
  mime_type    text,
  size_bytes   bigint,
  text         text,
  -- {titles[], skills[], years, education} - heuristic parser, user corrects
  parsed       jsonb not null default '{}'::jsonb,
  embedding    vector(1024),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger resumes_set_updated_at
  before update on resumes
  for each row execute function public.set_updated_at();

create index resumes_user_id_idx on resumes (user_id);

comment on table resumes is
  'CV file pointer + parsed text. Files live in a private Supabase Storage bucket; access via 15-minute signed URLs only (PLAN.md section 2).';

-- ---------------------------------------------------------------------------
-- consents
-- ---------------------------------------------------------------------------
create table consents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       consent_type not null,
  version    text not null,
  text_hash  text not null,                                    -- hash of the exact text shown
  ts         timestamptz not null default now(),
  ip         inet,
  ua         text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index consents_user_id_type_idx on consents (user_id, type);

comment on table consents is
  'Append-only consent log: version, hash of the shown text, timestamp, IP, UA. RETENTION: 7 years, metadata only (PLAN.md section 12, civil limitation period).';

-- ---------------------------------------------------------------------------
-- releases - immutable audit log of every profile disclosure
-- ---------------------------------------------------------------------------
-- APPEND-ONLY. RETENTION: 7 YEARS (PLAN.md section 12).
-- Deliberately has NO foreign keys to profiles / agencies / agency_roles:
-- the account-deletion job removes the profile but MUST keep these rows,
-- carrying only profile_user_hash (PLAN.md section 8).
-- No UPDATE or DELETE policy is ever granted; service role writes only.
create table releases (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid,                                      -- auth.users id, NULLed on account deletion
  profile_user_hash text not null,                             -- survives deletion; the durable subject key
  agency_id         uuid,
  role_id           uuid,
  released_fields   text[] not null default '{}',              -- e.g. {cv_url, email, phone, name}
  actor             text,                                      -- who triggered it: system | agency_user:<uuid>
  ts                timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index releases_profile_id_idx on releases (profile_id);
create index releases_agency_id_ts_idx on releases (agency_id, ts desc);

comment on table releases is
  'IMMUTABLE append-only disclosure log. 7-year retention (PLAN.md section 12). Survives account deletion via profile_user_hash. Powers the seeker-facing "who saw me" screen. No FKs on purpose.';

-- ---------------------------------------------------------------------------
-- swipes / saved_jobs / saved_searches / push_subscriptions / feedback
-- ---------------------------------------------------------------------------
create table swipes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  job_id     uuid not null references jobs(id) on delete cascade,
  direction  text not null check (direction in ('like', 'pass')),
  created_at timestamptz not null default now(),
  constraint swipes_user_job_unique unique (user_id, job_id)
);

create index swipes_user_id_created_at_idx on swipes (user_id, created_at desc);

create table saved_jobs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  job_id     uuid not null references jobs(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now(),
  constraint saved_jobs_user_job_unique unique (user_id, job_id)
);

create index saved_jobs_user_id_created_at_idx on saved_jobs (user_id, created_at desc);

create table saved_searches (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text,
  q              text,
  filters        jsonb not null default '{}'::jsonb,           -- same shape search_jobs() accepts
  alerts_enabled boolean not null default false,
  channel        text,                                         -- telegram | email | push
  last_run_at    timestamptz,
  last_seen_job_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger saved_searches_set_updated_at
  before update on saved_searches
  for each row execute function public.set_updated_at();

create index saved_searches_user_id_idx on saved_searches (user_id);

create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  ua           text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on push_subscriptions (user_id);

comment on table push_subscriptions is
  'Web Push (VAPID) endpoints. Written only after the seeker enables alerts (PLAN.md 7.5).';

-- "Did you hear back?" answers, 14 days after an apply-click (PLAN.md 7.3).
create table feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  job_id     uuid references jobs(id) on delete cascade,
  kind       text not null default 'heard_back' check (kind in ('heard_back', 'report', 'other')),
  heard_back text check (heard_back is null or heard_back in ('yes', 'no', 'pending')),
  comment    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger feedback_set_updated_at
  before update on feedback
  for each row execute function public.set_updated_at();

create index feedback_job_id_idx on feedback (job_id);
create index feedback_user_id_idx on feedback (user_id);

-- ---------------------------------------------------------------------------
-- employment_verifications
-- ---------------------------------------------------------------------------
create table employment_verifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Salted hash of the work-email domain. The email itself is DISCARDED
  -- immediately after the magic link is sent (PLAN.md section 9.4).
  domain_hash text not null,
  company_id  uuid references companies(id) on delete set null,
  verified_at timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '12 months'),
  created_at  timestamptz not null default now(),
  constraint employment_verifications_user_domain_unique unique (user_id, domain_hash)
);

create index employment_verifications_domain_hash_idx on employment_verifications (domain_hash);

comment on table employment_verifications is
  'Work-email verification, 12-month validity. Stores domain_hash only - the raw address is discarded after send. Freemail/disposable domains blocked upstream (PLAN.md 9.4).';

-- ---------------------------------------------------------------------------
-- salary_points - specially sensitive, UNLINKED FROM IDENTITY
-- ---------------------------------------------------------------------------
-- PLAN.md section 12: salary data is "specially sensitive" under Amendment 13
-- and is unlinked from identity AT WRITE TIME.
-- THIS TABLE HAS NO user_id COLUMN AND MUST NEVER GAIN ONE.
-- Dedupe happens through contributions_index (hashed) instead.
create table salary_points (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references companies(id) on delete set null,
  domain_hash    text,
  title_norm     text,
  seniority      seniority_level,
  region         text,
  bucket         int not null,                                 -- ILS 500 buckets, monthly gross
  flags          text[] not null default '{}',                 -- {verified, has_options, includes_bonus}
  year           int,
  contributed_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index salary_points_key_idx on salary_points (title_norm, seniority, region);
create index salary_points_company_id_idx on salary_points (company_id);

comment on table salary_points is
  'Verified salary contributions, deliberately UNLINKED from any user. No user_id column - never add one (PLAN.md section 12). Survives account deletion.';

-- Dedupe ledger for salary contributions. Holds only a salted hash of the
-- user id plus an opaque key, so it cannot re-link a salary point to a person.
create table contributions_index (
  id           uuid primary key default gen_random_uuid(),
  user_id_hash text not null,
  key          text not null,                                  -- e.g. salary:<company_id>:<year>
  created_at   timestamptz not null default now(),
  constraint contributions_index_hash_key_unique unique (user_id_hash, key)
);

comment on table contributions_index is
  'Anti-duplicate ledger for salary contributions. Hashed user id only; deliberately not joinable to salary_points (PLAN.md section 3 / 12).';
