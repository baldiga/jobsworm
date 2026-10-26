-- 0056_apply_ref.sql — the recruiter's own reference for a listing.
--
-- Asked for by a recruiter who is receiving CVs through the site and cannot
-- tell which listing each one answers. Their applicant tracking is a mailbox,
-- and every application arrives with whatever subject the sender chose.
--
-- So the listing can now carry a job number, and the job page asks the reader
-- to put it in the subject line. Where the apply target is an email address we
-- do better than ask: the `mailto:` gets a `subject=` with the number already
-- in it, so the reader has to do nothing at all and the recruiter still gets a
-- sorted mailbox.
--
-- ## Why a column and not a line in the description
--
-- A recruiter could already type "quote ref 4471" into the description, and
-- some do. The reason that is not good enough: it cannot be put in the mailto
-- subject, it cannot be shown next to the apply button where it is read, and
-- it cannot be validated. As free text in the middle of a description it is
-- read by roughly nobody.
--
-- Optional, and free text rather than a number. Recruiters use "R-2291",
-- "2026/44" and "REQ 118"; a numeric column would have forced them to lie.
-- Length-capped because it goes in a URL and on a card.

alter table jobs add column if not exists apply_ref text;

alter table jobs drop constraint if exists jobs_apply_ref_len;
alter table jobs add constraint jobs_apply_ref_len
  check (apply_ref is null or char_length(apply_ref) between 1 and 40);

comment on column jobs.apply_ref is
  'Recruiter''s own reference for this listing, shown next to the apply button '
  'and injected into the mailto subject. Employer-posted listings only.';

do $check$
begin
  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'jobs' and column_name = 'apply_ref'
  ), 'jobs.apply_ref missing';
end
$check$;
