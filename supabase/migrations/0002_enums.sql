-- 0002_enums.sql
-- Jobsworm - domain enums. Mirrors PLAN.md section 3 (data model) and
-- section 5.1 (job decomposition schema).

-- ATS / feed providers (PLAN.md section 4.2). `generic` = career page crawler.
create type ats_provider as enum (
  'comeet',
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'smartrecruiters',
  'recruitee',
  'workday',
  'personio',
  'bamboohr',
  'generic'
);

-- Job lifecycle. Jobs land as `draft` until decomposition fills the core
-- fields, then flip to `open`; closed-job detection sets `closed`.
create type job_status as enum ('draft', 'open', 'closed');

create type seniority_level as enum (
  'student',
  'junior',
  'mid',
  'senior',
  'lead',
  'manager',
  'director',
  'exec'
);

create type employment_type as enum (
  'full_time',
  'part_time',
  'contract',
  'freelance',
  'student',
  'internship'
);

create type remote_mode as enum ('onsite', 'hybrid', 'remote', 'unknown');

create type apply_method as enum ('ats', 'link', 'email', 'dm', 'form');

-- PLAN.md section 4.5 tech-only gate: everything outside TECH_FUNCTIONS that is
-- not a tech-company back-office role becomes `non_tech` and is dropped.
create type job_function as enum (
  'software_engineering',
  'data',
  'devops',
  'qa',
  'security',
  'it_support',
  'product',
  'design',
  'hardware',
  'ai_ml',
  'tech_pm',
  'technical_writing',
  'solutions_engineering',
  'sales',
  'marketing',
  'customer_success',
  'finance',
  'hr',
  'operations',
  'legal',
  'non_tech'
);

create type education_level as enum (
  'none',
  'bsc_required',
  'bsc_advantage',
  'msc_required',
  'phd'
);

-- Per-language requirement inside jobs.languages / profiles.languages.
create type lang_req as enum ('required', 'advantage', 'none');

create type job_lang as enum ('he', 'en', 'mixed');

-- PLAN.md section 8: Consent A (signup), Consent B (propose me),
-- referrer micro-consent, salary contribution consent.
create type consent_type as enum ('A', 'B', 'referrer', 'salary');

create type situation_state as enum ('active', 'open', 'not_looking');

-- Security clearance. PLAN.md section 12: army unit is NEVER collected,
-- only this yes/no/in_process flag.
create type clearance_status as enum ('yes', 'no', 'in_process');

-- PLAN.md section 4.3: who published a social "warm job" post. We store the
-- type and a salted hash only - never a poster profile or name.
create type poster_type as enum (
  'employee',
  'recruiter',
  'company_page',
  'founder',
  'unknown'
);

create type signal_platform as enum ('linkedin', 'facebook', 'yad2', 'alljobs');

create type crawl_status as enum ('active', 'paused', 'dead');

-- PLAN.md section 9.5: double opt-in intro state machine.
create type intro_state as enum (
  'requested',
  'accepted',
  'declined',
  'not_this_company',
  'expired',
  'released'
);
