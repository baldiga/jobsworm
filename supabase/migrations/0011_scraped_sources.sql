-- Scraped supplementary sources (PLAN.md 4.3, 4.4).
--
-- ATS postings always resolve to a `companies` row, because we seeded the
-- employer before we ever fetched the feed. Scraped postings do not: AllJobs
-- and Facebook name an employer in free text, and a large share of those are
-- staffing agencies we have no reason to track as companies. Creating a stub
-- company per employer name would fill the company index with agency noise,
-- so the raw name lives on the job instead. `company_id` is still populated
-- when the name matches an employer we already track.

alter table jobs
  add column if not exists company_name_raw text;

comment on column jobs.company_name_raw is
  'Employer name as printed by a scraped source. Null for ATS jobs, which use company_id.';

-- Link-out sources expire rather than being closed by a feed diff: nobody
-- tells us when an AllJobs listing disappears, so a sighting has a shelf life.
create index if not exists jobs_expires_at_open_idx
  on jobs (expires_at)
  where status = 'open' and expires_at is not null;

-- Social and board postings are looked up by source when re-importing.
create index if not exists jobs_source_provider_idx
  on jobs (source_provider, status);
