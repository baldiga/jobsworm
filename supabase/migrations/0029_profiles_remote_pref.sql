-- Work setup: the column the app has always meant, replacing one it could
-- never write to.
--
-- `profiles.hybrid_tolerance` was declared in 0004_people.sql as
--
--     hybrid_tolerance int check (hybrid_tolerance is null or
--                                 (hybrid_tolerance >= 0 and hybrid_tolerance <= 7))
--
-- — days per week in the office, on a 0-7 scale. Every consumer of it since
-- has treated it as one of 'onsite' | 'hybrid' | 'remote' instead:
-- api/profile/route.ts validates against a REMOTE set and writes the string,
-- ProfileEditor.tsx renders it as three chips, and me/page.tsx selects it as
-- text.
--
-- Postgres, correctly, refuses:
--
--     invalid input syntax for type integer: "hybrid"
--
-- and because the write is one upsert, the type error aborts the whole
-- statement. So a profile save with a work setup selected has NEVER worked —
-- not for this user, not for anyone. The evidence is in the data: of 332
-- profiles, `hybrid_tolerance is not null` matches exactly 0. It was reported
-- as "after changing the preferences, i was unable to save", which is precisely
-- what it does, and the failure took the regions and seniority edits down with
-- it because they rode in the same statement.
--
-- The three-value enum is the right model, not the 0-7 scale: nothing in the
-- product asks how many days you would come in, and `jobs.remote` is already
-- onsite/hybrid/remote, so a matching preference can be compared to it
-- directly. A new column rather than a type change on the old one, because
-- `hybrid_tolerance` holds no data to migrate and an `alter type` here would
-- only invent a mapping nobody chose.

alter table profiles
  add column if not exists remote_pref text
    check (remote_pref is null or remote_pref in ('onsite', 'hybrid', 'remote'));

comment on column profiles.remote_pref is
  'Preferred work setup: onsite | hybrid | remote. Compared against jobs.remote. '
  'Replaces hybrid_tolerance, an int 0-7 the app only ever tried to write strings to.';

-- Left in place, unused and always null, rather than dropped in the same
-- migration that adds its replacement: dropping a column is the one step here
-- that cannot be undone, and it carries no rows worth the risk of doing both
-- at once. It can go in a later pass once nothing references it.
comment on column profiles.hybrid_tolerance is
  'DEPRECATED and always null. Superseded by remote_pref. Was int 0-7 (office '
  'days per week); the application only ever wrote onsite/hybrid/remote to it, '
  'so every such save failed. Do not read or write this column.';
