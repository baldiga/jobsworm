-- Let the importer tell an unchanged posting from a changed one.
--
-- Every six hours the scrape workflow re-imported the WHOLE index. Not because
-- anything had changed: `save_page` upserts each raw page with a fresh
-- `fetched_at`, so the importer's "since" window matches every row every time,
-- and it re-upserted ~4,800 identical jobs. Four times a day.
--
-- In Postgres an UPDATE that changes nothing still costs everything: a new tuple
-- version, an entry in every index the row touches, WAL, and later autovacuum to
-- clean up the corpse. `jobs` carries a GIN index over a generated tsvector, so
-- each of those rewrites does real text-indexing work. That is what has been
-- taking the database down: not one heavy query, a pointless rewrite of the
-- entire table, on a schedule.
--
-- `content_hash` is what the importer compares against to skip a row it has
-- already stored unchanged. It is a plain text column and deliberately has no
-- index: it is only ever read as part of a per-source sweep that is already
-- filtering on source_provider, which is indexed.
--
-- Existing rows get NULL, which reads as "unknown, import it" — so the first
-- pass after this rewrites everything once and every pass after it is quiet.

alter table jobs add column if not exists content_hash text;

comment on column jobs.content_hash is
  'Hash of the fields an importer would write. Lets a re-import skip a posting whose content has not changed, instead of rewriting the row and its indexes.';
