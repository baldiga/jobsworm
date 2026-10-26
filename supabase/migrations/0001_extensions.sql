-- 0001_extensions.sql
-- Jobsworm - required Postgres extensions.
-- PLAN.md S2: pgvector (HNSW, cosine, 1024 dims), tsvector + GIN, pg_trgm, pg_cron, RLS everywhere.
--
-- pg_cron is deliberately NOT created here: it is unavailable on some local /
-- managed setups and requires shared_preload_libraries. See 0009_cron.sql,
-- which creates and schedules it inside a guarded DO block.

create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists pgcrypto;
