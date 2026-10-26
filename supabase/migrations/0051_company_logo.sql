-- 0051_company_logo.sql — a company name and logo on the recruiter profile,
-- snapshotted onto every listing they post.
--
-- The name already existed twice: `recruiters.org_name` is the profile-level
-- one, and `jobs.company_name_raw` is what each listing shows (they differ for
-- an agency posting "Confidential client via X"). Only the logo is new.
--
-- ## Snapshot, not a join
--
-- `jobs.company_logo_path` copies the recruiter's logo at post time rather
-- than pointing at it. A logo is branding and branding changes; a listing that
-- ran in March should still look like it did in March, and a rebrand should
-- not silently rewrite history across every past listing. It also keeps the
-- job row self-contained, which is what every reader of it already assumes.
--
-- ## Where it is rendered
--
-- Sponsored cards and the job page. `search_jobs`, `match_jobs_for_me` and
-- `company_jobs` would each need their OUT row type changed to carry it into
-- organic cards, and that is a drop-and-recreate of a 171-line function on the
-- busiest path on the site — not something to do by hand on the day the first
-- listing is sold. The column exists and is populated, so those pick it up
-- whenever they are next rebuilt.

alter table recruiters add column if not exists logo_path text;
alter table jobs       add column if not exists company_logo_path text;

comment on column recruiters.logo_path is
  'Object path in the public company-logos bucket. Profile level; copied onto each listing.';
comment on column jobs.company_logo_path is
  'Snapshot of the recruiter logo at post time. Never back-filled from the profile.';

-- ---------------------------------------------------------------------------
-- The bucket. PUBLIC, unlike `resumes`.
--
-- A logo is drawn on a job card for anonymous visitors, so a signed URL would
-- mean minting one per card per render. The tradeoff is explicit: nothing goes
-- in here that is not already meant to be on a public page, and the upload
-- route enforces that by accepting only small PNG and JPEG files.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 524288,
        array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may read a logo: that is the point of the bucket.
drop policy if exists "company logos are public" on storage.objects;
create policy "company logos are public"
  on storage.objects for select
  using (bucket_id = 'company-logos');

/*
 * Writes are confined to a folder named for the uploader.
 *
 * Without the prefix check any signed-in user could overwrite any other
 * recruiter's logo — which on a public bucket means putting an arbitrary image
 * on somebody else's paid listing. `storage.foldername()[1]` is the first path
 * segment, and the upload route names it with `auth.uid()`.
 */
drop policy if exists "recruiters write their own logo" on storage.objects;
create policy "recruiters write their own logo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "recruiters replace their own logo" on storage.objects;
create policy "recruiters replace their own logo"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- recruiter_me() returns the logo, so the profile form can show what is set.
-- It returns jsonb, so adding a key needs no signature change.
-- ---------------------------------------------------------------------------
create or replace function recruiter_me()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select case when r.user_id is null then null else jsonb_build_object(
    'user_id', r.user_id,
    'kind', r.kind,
    'org_name', r.org_name,
    'website', r.website,
    'contact_email', r.contact_email,
    'status', r.status,
    'company_id', r.company_id,
    'agency_id', r.agency_id,
    'verified_at', r.verified_at,
    'logo_path', r.logo_path
  ) end
  from recruiters r
  where r.user_id = auth.uid();
$fn$;

grant execute on function recruiter_me() to authenticated;
