# Contributing to Jobsworm

Thanks for wanting to help. The live service was retired in October 2026, so what is
left is a reference for anyone building an aggregator — and improvements to it are
welcome: bug fixes, new ATS adapters, better Hebrew handling, sharper classification,
clearer docs.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Small fix?** Open a pull request directly.
- **Anything bigger** — a new source, a schema change, a new page — open an issue
  first so we can agree on the approach before you spend a weekend on it.
- **Found a security problem?** Do not open an issue. Follow [SECURITY.md](SECURITY.md).
- **Never paste a key, token, cookie or `.env` file** into an issue, a PR, a log or a
  screenshot. If you do by accident, rotate it immediately; deleting the comment is not
  enough.

## Setting up

Follow [Build your own](README.md#build-your-own) in the README. You need Node 24,
pnpm 10, Docker and, for the worker, Python 3.12. A local Supabase stack plus
`pnpm seed && pnpm ingest:once` gives you a realistic index to work against.

## The checks a PR must pass

CI runs these on every pull request; run them locally first.

```bash
pnpm test                    # unit tests across core, adapters and web
pnpm typecheck               # the packages the web build does not compile
pnpm lint                    # ESLint on apps/web
pnpm --filter web build      # production build, which also typechecks the web app
```

CI also applies every migration to a throwaway Postgres (`supabase db reset`), so a
migration that does not apply cleanly from zero fails the build. Secret scanning runs
on every push.

## How the code is written

**Comments explain why, not what.** You will notice long comments above code that looks
simple. That is deliberate: most of them record a bug that happened, a number that was
measured, or a constraint that is not visible in the code — "this used to be `??`, and a
blank Vercel variable took every page down". Keep that habit. If you fix something
non-obvious, leave the next person the reason.

**Match the surrounding code.** Naming, structure, comment density and idiom should
look like the file you are in.

**Rules, not models.** Decomposition is deterministic and runs without an LLM. A change
that adds a runtime model call needs a strong case and an issue first.

**Tests come with behaviour changes.** A misclassified job is the most common bug
report; the fix is a failing test in `packages/core/src/*.test.ts` that reproduces it,
then the rule change that makes it pass.

## Common contributions

### Fixing a misclassification

1. Add the job's title and text as a case in `decompose.test.ts` (or the relevant
   `*.test.ts`) and watch it fail.
2. Change the rule or the dictionary in `packages/core/src/`.
3. Run the whole suite: rules interact, and a fix for one title often moves another.
4. Against a real index, `pnpm redecompose` (report only; `--apply` writes) shows how many stored jobs the
   change would move, and in which direction. Count the losses as well as the gains.

### Adding a skill

Skills live in `packages/core/src/data/skills.ts` (technical) and `business-skills.ts`
(go-to-market). Each entry is a canonical name plus aliases, in English and Hebrew.

- Check the new name and aliases do not collide with an existing entry. A new
  "distributed computing" entry once silently took 286 jobs away from "distributed
  systems"; adding it as an alias was the right fix.
- Avoid words that are requirements but not skills: "English" belongs to languages,
  and as a skill it would tag most of the index.
- `scripts/seed/mine_skills.ts` lists terms the job corpus asks for that the dictionary
  does not know, which is a good place to look for gaps.

### Adding an ATS provider

1. Implement the `Adapter` interface (`packages/adapters/src/types.ts`) in
   `packages/adapters/src/providers/<name>.ts`: `buildFeedUrl`, `fetchJobs`, and
   `detect` if the token can be read from a careers page. Use `fetchJson` from
   `http.ts`, which already does per-host pacing, retries and `Retry-After`.
2. Register it in `packages/adapters/src/index.ts`.
3. Add its fingerprint to `scripts/seed/detect_ats.py` so discovery can find employers
   that use it.
4. Add the provider to the `ats_provider` enum in a **new** migration.
5. Test the mapping against a saved response, not a live call.

### Adding a source that is not an ATS feed

Read [docs/data-sources-and-legal.md](docs/data-sources-and-legal.md) first. Then:

1. **Read the site's terms of use** — not only `robots.txt`. If the terms forbid
   republishing listings, the source cannot be added, however open the site looks. Put
   what you found in the PR description.
2. Write the fetcher as a module in `apps/worker/jobswarm_scrape/sources/` returning
   `ScrapedJob` rows, and add a CLI command in `cli.py` with `--dry-run` support.
3. Teach `packages/adapters/src/import-scraped.ts` to map it, including its expiry.
4. Public content only, nothing behind a login; hash any personal identifier with
   `POSTER_HASH_SALT`; never store a person's name or contact details.

### Changing the schema

- **Add a new migration; never edit one that has been applied.** Files in
  `supabase/migrations/` are numbered; take the next number.
- **Revoke from `public`, not only from roles.** In Postgres, `revoke execute ... from
  anon, authenticated` does nothing if the grant is held by `PUBLIC`, which is the
  default for new functions. Write `revoke execute on function ... from public`, then
  grant to the roles that need it.
- Every `SECURITY DEFINER` function callable by `anon` must appear in the allow-list
  guard in `0055_lock_remaining_definers.sql`; the migration fails otherwise. If you add
  one, extend the list in a new migration and say why it is safe to call anonymously.
- New tables get row-level security in the same migration that creates them.
- Run `pnpm exec supabase db reset` locally to prove the full chain applies.

## Pull request checklist

- [ ] The change is focused; unrelated clean-ups go in their own PR.
- [ ] Tests cover the behaviour change, and `pnpm test`, `pnpm typecheck`, `pnpm lint`
      and `pnpm --filter web build` pass.
- [ ] Non-obvious decisions have a comment explaining why.
- [ ] New environment variables are added to `.env.example` with a comment.
- [ ] Migrations are new files, revoke from `public`, and enable RLS on new tables.
- [ ] A new source links to its terms of use in the PR description.
- [ ] No keys, personal data or real people's contact details anywhere in the diff.

## Good first issues

Look for the `good first issue` label. Some places that always have room:

- missing skills, aliases and Hebrew spellings in `packages/core/src/data/`;
- cities and neighbourhood names in `locations.ts`;
- a test case for a posting the decomposer gets wrong — paste the title and
  description text, since there is no live site to link to;
- docs: anything in the README that tripped you up while setting up.

## Licensing of contributions

By submitting a contribution you agree that it is licensed under the project's
[MIT License](LICENSE). The brand assets are not open for contribution or reuse; see
[docs/brand/NOTICE.md](docs/brand/NOTICE.md).
