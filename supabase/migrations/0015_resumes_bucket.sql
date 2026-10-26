-- Private bucket for CV files (PLAN.md section 2: private bucket, signed URLs).
--
-- Nothing here is world-readable. Each user can only touch objects under a
-- folder named after their own uid, which is what the upload path in
-- /api/cv builds.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  5242880,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/octet-stream'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.foldername(name) splits the object path; [1] is the first segment,
-- which the upload code sets to the owner's uid.
drop policy if exists resumes_owner_read on storage.objects;
create policy resumes_owner_read on storage.objects for select
  to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists resumes_owner_insert on storage.objects;
create policy resumes_owner_insert on storage.objects for insert
  to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists resumes_owner_delete on storage.objects;
create policy resumes_owner_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
