-- 0041_cv_review.sql — two schema defects behind the CV upload, and the column
-- the review step needs.
--
-- ## `resumes.storage_path` is NOT NULL and the route writes NULL into it
--
-- `api/cv/route.ts` uploads the file, and on failure inserts the row with
-- `storage_path: uploadError ? null : path`. The column has been `not null`
-- since 0004, so that insert fails — and the route never checks the error, so
-- it fails silently.
--
-- The consequences are worse than a lost file. `resumes.parsed` is where "the
-- previous parse" is read from, and that is what decides whether a profile
-- field was edited by hand or merely left over. With no row written, the next
-- upload compares against an older parse, concludes the user hand-edited
-- fields they never touched, and refuses to update them — permanently. One
-- storage hiccup and a person's CV analysis stops working, with nothing said.
--
-- Nullable is the right shape, not a placeholder path: the parse is the
-- valuable part and it succeeded. A row with text and no file is a true
-- statement about what happened.
--
-- ## `profiles.cv_reviewed_at`
--
-- The parser's output is about to be shown to the person for correction rather
-- than written straight into their profile. This records that they saw it,
-- which is what separates "we guessed this" from "they confirmed this" — and
-- the second is the only one worth treating as fact.

alter table resumes alter column storage_path drop not null;

comment on column resumes.storage_path is
  'Private bucket path, or NULL when the upload failed and only the parse survived. See 0041.';

alter table profiles
  add column if not exists cv_reviewed_at timestamptz;

comment on column profiles.cv_reviewed_at is
  'When the person last confirmed what we read from their CV. Null means nobody has checked it.';
