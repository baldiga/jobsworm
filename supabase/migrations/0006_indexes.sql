-- 0006_indexes.sql
-- Jobsworm - search and hot-path indexes.
-- PLAN.md section 6 (search) and section 4.2 (ingestion loop).

-- ---------------------------------------------------------------------------
-- Full-text search
-- ---------------------------------------------------------------------------
create index jobs_search_tsv_idx on jobs using gin (search_tsv);

-- ---------------------------------------------------------------------------
-- Vector search - bge-m3, 1024 dims, cosine (PLAN.md section 2)
-- Built now while the table is empty; embeddings backfill in session F8.
-- ---------------------------------------------------------------------------
create index jobs_embedding_hnsw_idx
  on jobs using hnsw (embedding vector_cosine_ops);

create index profiles_embedding_hnsw_idx
  on profiles using hnsw (embedding vector_cosine_ops);

create index agency_roles_embedding_hnsw_idx
  on agency_roles using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Trigram fuzzy matching (typos, Hebrew/English variants, company name lookup)
-- ---------------------------------------------------------------------------
create index jobs_title_norm_trgm_idx
  on jobs using gin (title_norm gin_trgm_ops);

create index companies_name_en_trgm_idx
  on companies using gin (name_en gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Listing / filtering hot paths
-- ---------------------------------------------------------------------------
create index jobs_status_posted_at_idx on jobs (status, posted_at desc);
create index jobs_company_id_idx on jobs (company_id);
create index jobs_fingerprint_idx on jobs (fingerprint);

-- Feeds expire_stale_jobs() (see 0008).
create index jobs_expires_at_open_idx
  on jobs (expires_at)
  where status = 'open';

-- Feeds the ingestion lease query:
--   next_run_at <= now() and lease_until < now() and crawl_status = 'active'
create index companies_next_run_at_active_idx
  on companies (next_run_at)
  where crawl_status = 'active';

-- ---------------------------------------------------------------------------
-- Array containment filters (skills:/stack: search facets)
-- ---------------------------------------------------------------------------
create index jobs_skills_required_gin_idx on jobs using gin (skills_required);
create index jobs_tech_stack_gin_idx on jobs using gin (tech_stack);
