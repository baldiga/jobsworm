-- 0003_core.sql
-- Jobsworm - core supply-side tables.
-- PLAN.md section 3 "Core tables" + section 5.1 job decomposition schema.

-- ---------------------------------------------------------------------------
-- shared updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Shared BEFORE UPDATE trigger: stamps updated_at = now().';

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
create table companies (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name_en             text,
  name_he             text,
  -- canonical dedupe key (PLAN.md section 4.1). Nullable: social-sourced stubs
  -- may have no domain yet; unique still allows many NULLs.
  domain              text unique,
  linkedin_slug       text,
  registrar_id        text,                                   -- data.gov.il CKAN (h.p.)
  sources             text[] not null default '{}',           -- union, never overwritten with empty
  industry            text,
  size_bucket         text,                                   -- 1-10 / 11-50 / 51-200 / ...
  hq_city             text,

  -- ATS detection (PLAN.md section 4.2)
  ats_provider        ats_provider,
  ats_token           text,
  ats_feed_url        text,
  ats_confidence      real check (ats_confidence is null or (ats_confidence >= 0 and ats_confidence <= 1)),
  careers_url         text,

  -- crawl scheduling / leasing (PLAN.md section 4.2 ingestion loop)
  crawl_status        crawl_status not null default 'active',
  next_run_at         timestamptz not null default now(),
  lease_until         timestamptz,
  fail_count          int not null default 0,
  interval_hours      int not null default 12,

  -- derived reputation / ghost-meter inputs (PLAN.md section 5.5)
  response_rate_90d   real,
  median_days_to_close real,
  hiring_velocity_30d  int,

  tech_stack          text[] not null default '{}',
  has_referral_program boolean not null default false,
  referrers_count     int not null default 0,
  salary_points_count int not null default 0,

  -- "claim your company page" (PLAN.md section 10)
  claimed_by          uuid references auth.users(id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger companies_set_updated_at
  before update on companies
  for each row execute function public.set_updated_at();

comment on table companies is
  'Employers and (flagged) recruiting agencies. Canonical dedupe key is domain; fallback normalized name + Jaro-Winkler >= 0.92 (PLAN.md 4.1).';
comment on column companies.sources is
  'Provenance list (snc, common_crawl, ats_enum, zooq, ...). Union on upsert; never overwrite a non-empty value with empty.';

-- ---------------------------------------------------------------------------
-- jobs_tsv: the FTS document builder for jobs.search_tsv.
--
-- A generated column may only call IMMUTABLE functions, and array_to_string is
-- merely STABLE, so the whole expression is wrapped here and declared immutable.
-- That is honest: for a text[] and a constant delimiter the result really is
-- deterministic. Weights: A title, B skills and stack, D description
-- (PLAN.md section 6).
-- ---------------------------------------------------------------------------
create or replace function jobs_tsv(
  p_title_norm       text,
  p_title_raw        text,
  p_tech_stack       text[],
  p_skills_required  text[],
  p_description_norm text
)
returns tsvector
language sql
immutable
parallel safe
as $fn$
  select setweight(to_tsvector('simple'::regconfig,
           coalesce(p_title_norm, '') || ' ' || coalesce(p_title_raw, '')), 'A')
      || setweight(to_tsvector('simple'::regconfig,
           array_to_string(coalesce(p_tech_stack, '{}'), ' ') || ' ' ||
           array_to_string(coalesce(p_skills_required, '{}'), ' ')), 'B')
      || setweight(to_tsvector('simple'::regconfig,
           coalesce(p_description_norm, '')), 'D');
$fn$;

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------
create table jobs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references companies(id) on delete cascade,

  -- Provenance. Free text because a source may be an ats_provider value
  -- ('greenhouse', 'comeet', ...) OR a signal_platform value
  -- ('linkedin', 'facebook', 'yad2', 'alljobs').
  source_provider     text not null,
  source_external_id  text,
  source_url          text,
  -- content fingerprint for cross-source dedupe (PLAN.md 4.4)
  fingerprint         text,

  -- === decomposition columns (PLAN.md section 5.1) ============================
  title_raw           text,
  title_norm          text,
  "function"          job_function,
  sub_function        text,
  seniority           seniority_level,
  req_years_min       int,
  req_years_max       int,
  employment_type     employment_type,
  remote              remote_mode not null default 'unknown',
  hybrid_days_office  int check (hybrid_days_office is null or (hybrid_days_office >= 0 and hybrid_days_office <= 7)),
  -- {raw, city, cities[], region, lat, lng, country, abroad}
  location            jsonb,
  skills_required     text[] not null default '{}',
  skills_nice         text[] not null default '{}',
  tech_stack          text[] not null default '{}',
  -- {"hebrew":"required","english":"advantage"} - values are lang_req
  languages           jsonb,
  education           education_level,
  clearance           boolean,
  domain              text,                                   -- business domain: fintech, cyber, adtech...
  benefits            text[] not null default '{}',
  referral_bonus_mentioned boolean not null default false,
  -- {min,max,currency,period,raw,source} - explicit numbers from the posting only
  salary              jsonb,
  -- {p25,p50,p75,n,method,confidence} - nightly, PLAN.md 5.4, never LLM
  salary_estimate     jsonb,
  -- per-field {"seniority": {"_conf":0.82,"_src":"rule"}, ...} (PLAN.md section 5)
  decomp_meta         jsonb not null default '{}'::jsonb,
  -- ===========================================================================

  apply_url           text,
  apply_method        apply_method,

  description_html    text,
  description_text    text,
  description_norm    text,                                   -- normalize_he() applied, see 0008
  excerpt             text,                                   -- <= 300 chars for link-out sources

  -- FTS. GENERATED, so it may only reference plain stored columns and
  -- immutable functions - no other generated column, no normalize_he().
  -- Weights: A title, B skills/stack, D description (PLAN.md section 6).
  -- FTS document, built by the immutable helper above.
  search_tsv tsvector generated always as (
    jobs_tsv(title_norm, title_raw, tech_stack, skills_required, description_norm)
  ) stored,

  embedding           vector(1024),                           -- bge-m3, cosine, HNSW

  lang                job_lang,
  status              job_status not null default 'draft',
  is_agency           boolean not null default false,
  is_social_only      boolean not null default false,
  company_hidden      boolean not null default false,         -- Yad2 anonymized employers
  quality_flags       text[] not null default '{}',

  posted_at           timestamptz,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  closed_at           timestamptz,
  expires_at          timestamptz,
  repost_count        int not null default 0,
  decomp_version      text,

  -- engagement / ghost-meter inputs (PLAN.md section 5.5)
  view_count          int not null default 0,
  save_count          int not null default 0,
  apply_clicks_7d     int not null default 0,
  apply_clicks_30d    int not null default 0,
  heard_back_yes      int not null default 0,
  heard_back_no       int not null default 0,
  heard_back_pending  int not null default 0,
  ghost_score         int check (ghost_score is null or (ghost_score >= 0 and ghost_score <= 100)),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint jobs_source_unique unique (source_provider, source_external_id)
);

create trigger jobs_set_updated_at
  before update on jobs
  for each row execute function public.set_updated_at();

comment on table jobs is
  'One row per canonical job. ATS feeds are canonical; social/Yad2/AllJobs sightings of the same job attach as job_signals instead of duplicating.';
comment on column jobs.source_provider is
  'ats_provider value OR signal_platform value. Text (not an enum) because the two namespaces are unioned here.';
comment on column jobs.decomp_meta is
  'Per-field confidence/provenance from PLAN.md section 5: {"<field>": {"_conf": 0..1, "_src": "feed|rule|llm"}}.';
comment on column jobs.search_tsv is
  'Generated FTS vector, config "simple" (Hebrew has no stemmer dictionary). Normalization happens upstream when writing title_norm / description_norm.';
comment on column jobs.salary is
  'Explicit numbers stated in the posting only. Never an estimate - see salary_estimate.';

-- ---------------------------------------------------------------------------
-- job_signals - social / link-out sightings (PLAN.md section 4.3)
-- ---------------------------------------------------------------------------
create table job_signals (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references jobs(id) on delete cascade,
  platform          signal_platform not null,
  post_url          text,
  posted_at         timestamptz,
  poster_type       poster_type not null default 'unknown',
  -- salted hash only. PLAN.md section 4.3: no poster profiles, ever.
  poster_hash       text,
  engagement        jsonb not null default '{}'::jsonb,       -- {likes, comments, shares}
  mentions_referral boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger job_signals_set_updated_at
  before update on job_signals
  for each row execute function public.set_updated_at();

create unique index job_signals_platform_post_url_key
  on job_signals (platform, post_url)
  where post_url is not null;

create index job_signals_job_id_idx on job_signals (job_id);

comment on table job_signals is
  'A public post / listing that announced a job. Never stores a poster name or profile - only poster_type and a salted poster_hash (PLAN.md 4.3, 12).';

-- ---------------------------------------------------------------------------
-- raw_posts / raw_pages - re-parseable source cache
-- ---------------------------------------------------------------------------
create table raw_posts (
  id         uuid primary key default gen_random_uuid(),
  hash       text not null unique,                            -- content hash, dedupe key
  url        text,
  source     text not null,                                   -- linkedin | facebook | ...
  content    text,
  meta       jsonb not null default '{}'::jsonb,
  rung       int,                                             -- scraping ladder rung (PLAN.md 4.7)
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index raw_posts_fetched_at_idx on raw_posts (fetched_at);

comment on table raw_posts is
  'Raw social post cache. RETENTION: 30 days (PLAN.md section 3 / 4.3). Purged by a scheduled job.';

create table raw_pages (
  id         uuid primary key default gen_random_uuid(),
  hash       text not null unique,
  url        text,
  source     text not null,
  content    text,
  meta       jsonb not null default '{}'::jsonb,
  rung       int,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index raw_pages_fetched_at_idx on raw_pages (fetched_at);

comment on table raw_pages is
  'Raw HTML/Markdown page cache so parsing can be re-run without re-fetching. RETENTION: 14 days (PLAN.md 3 / 4.7).';

-- ---------------------------------------------------------------------------
-- sources - per-source crawl state
-- ---------------------------------------------------------------------------
create table sources (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,                          -- e.g. facebook:group:123456
  kind         text not null,                                 -- ats | facebook_group | linkedin | yad2 | alljobs | generic
  label        text,
  url          text,
  -- candidate | approved | rejected (an admin approves Facebook groups)
  review_state text not null default 'candidate',
  crawl_status crawl_status not null default 'active',
  config       jsonb not null default '{}'::jsonb,
  state        jsonb not null default '{}'::jsonb,            -- last cursor, last post id, ...
  next_run_at  timestamptz not null default now(),
  last_run_at  timestamptz,
  fail_count   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger sources_set_updated_at
  before update on sources
  for each row execute function public.set_updated_at();

comment on table sources is
  'Per-source crawl state and approval status. Public Facebook groups only; private groups are rejected regardless of size (PLAN.md 4.3, 12).';

-- ---------------------------------------------------------------------------
-- runs - one row per ingestion invocation
-- ---------------------------------------------------------------------------
create table runs (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,                               -- ats_ingest | social_ingest | decomp | embed | ...
  source_id      uuid references sources(id) on delete set null,
  company_id     uuid references companies(id) on delete set null,
  status         text not null default 'running',             -- running | ok | failed
  rung           int,                                         -- scraping ladder rung actually used
  items_seen     int not null default 0,
  items_upserted int not null default 0,
  items_closed   int not null default 0,
  items_failed   int not null default 0,
  spend          jsonb not null default '{}'::jsonb,          -- {proxy_mb, requests, credits}
  error          text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index runs_kind_started_at_idx on runs (kind, started_at desc);
create index runs_company_id_idx on runs (company_id);

-- ---------------------------------------------------------------------------
-- events - product analytics (PLAN.md section 15)
-- ---------------------------------------------------------------------------
create table events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,                                   -- search, apply_click, save, swipe, ...
  user_id    uuid references auth.users(id) on delete set null,
  session_id text,
  job_id     uuid references jobs(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_name_created_at_idx on events (name, created_at desc);
create index events_user_id_idx on events (user_id) where user_id is not null;

comment on table events is
  'Append-only product analytics. Write-only for clients (RLS: insert, no select). Never put PII in props.';

-- ---------------------------------------------------------------------------
-- metrics - daily rollups (PLAN.md section 15)
-- ---------------------------------------------------------------------------
create table metrics (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,                                   -- open_jobs, freshness_p95, intro_accept_rate, ...
  value      numeric,
  dims       jsonb not null default '{}'::jsonb,
  bucket_at  date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint metrics_key_bucket_dims_unique unique (key, bucket_at, dims)
);

create trigger metrics_set_updated_at
  before update on metrics
  for each row execute function public.set_updated_at();
