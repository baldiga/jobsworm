# Architecture

How a job gets from an employer's careers page to a search result, and where each piece
lives. Read the [README](../README.md) first for the overview and setup.

## The shape of it

```
                      ┌──────────────────────── collect ────────────────────────┐
 Employer ATS APIs ──▶│ packages/adapters  (TypeScript, Vercel Cron)             │──┐
                      │   lease due companies → fetch → decompose → upsert      │  │
                      └──────────────────────────────────────────────────────────┘  │
                      ┌──────────────────────────────────────────────────────────┐  │
 Feeds, boards, posts▶│ apps/worker        (Python, GitHub Actions)              │  │
                      │   fetch ladder → raw_pages / raw_posts                    │  │
                      └───────────────┬──────────────────────────────────────────┘  │
                                      │ pnpm import:scraped                          │
                                      ▼                                              ▼
                      ┌──────────────────────── decompose ──────────────────────────────┐
                      │ packages/core   decompose() · tech gate · agency · fingerprint  │
                      └───────────────────────────────┬─────────────────────────────────┘
                                                      ▼
                      ┌──────────────────────── store & maintain ───────────────────────┐
                      │ Supabase Postgres   jobs · companies · sources · runs           │
                      │   pg_cron: expire · dedupe · purge raw cache · daily metrics    │
                      └───────────────────────────────┬─────────────────────────────────┘
                                                      ▼
                      ┌──────────────────────── serve ──────────────────────────────────┐
                      │ apps/web (Next.js)   search_jobs() · facets · job pages · /match │
                      └──────────────────────────────────────────────────────────────────┘
```

Two collection paths, one decomposer, one table. Everything a seeker sees is a row in
`jobs` with `status = 'open'`.

## Collect

### ATS feeds — `packages/adapters`

Most of the index. Employers' applicant-tracking systems expose a public JSON endpoint
that their own careers page calls; reading it is reading what the employer published in
order to be found.

- **Adapters** (`src/providers/`): Comeet, Greenhouse, Lever, Ashby, SmartRecruiters,
  Recruitee. Each implements `Adapter` from `src/types.ts`: build the feed URL for a
  token, fetch and map the postings, and optionally detect the token in a careers page.
- **The loop** (`src/ingest.ts`): lease the companies whose `next_run_at` has passed
  (`lease_until` stops two runners taking the same one), fetch, decompose, upsert on
  `(source_provider, source_external_id)`, and close every job the employer stopped
  listing. The next run is scheduled by activity — 4 hours for a busy board, 12 by
  default, 48 for an empty one — with exponential backoff on failure and `dead` after
  10 consecutive failures. Every company gets a `runs` row, success or not.
- **Politeness** (`src/http.ts`): an identifiable user-agent built from
  `NEXT_PUBLIC_SITE_URL`, a minimum gap per host, bounded concurrency, and retries that
  honour `Retry-After`.
- **Scheduling**: `vercel.json` calls `/api/cron/ingest` — four passes after midnight
  and a small one every hour. Locally, `pnpm ingest:once` runs one pass.

Employers come from `data/companies.seed.json` via `pnpm seed`. Finding more is
`scripts/seed/`: `detect_ats.py` reads careers pages and recognises each ATS by its
fingerprints; `vc_portfolios.py` harvests candidate domains weekly (`discover.yml`).

### Everything else — `apps/worker`

Python, because the scraping ecosystem is, and because some fetches take longer than a
serverless function may run. GitHub Actions is the scheduler (`scrape.yml` twice a day,
`social.yml` every second day for the metered source).

| command | source | how |
|---|---|---|
| `drushimavodot` | Drushim-Avodot partner feed | documented JSON API, attribution shown on the site |
| `workable` | Workable's public job board | JSON API, partitioned by city and role because it caps answers at 20 |
| `revhub` | a curated go-to-market feed | one static JSON file |
| `fb-scrape` | public Facebook group previews | residential fetch, a few posts per group |
| `fb-posts` | public Facebook post permalinks | search (Brave API) finds permalinks, each is read in full |
| `fb-apify` | public Facebook groups via Apify | a paid actor; `--dry-run` starts nothing |
| `linkcheck` | every open job | closes listings whose page says the job is gone |

`ladder.py` is the fetch escalation: plain HTTP first, then a stealth browser, then a
residential proxy, always the cheapest rung that works, with per-domain delays. Each
source writes what it fetched to `raw_pages` (listings) or `raw_posts` (social posts).
Raw rows are kept 14 and 30 days, so parsing can be re-run without fetching again.

Social posts carry personal data by nature, so the worker stores a salted hash of the
poster (`POSTER_HASH_SALT`) and a coarse poster type, never a name, and caps excerpts
at 300 characters.

### From raw to jobs — `packages/adapters/src/import-scraped.ts`

`pnpm import:scraped --sources=...` reads recent raw rows, maps each source to the
common shape, decomposes, and upserts. Things worth knowing:

- **Content hash.** An unchanged row is skipped unless it is more than three days old,
  which turned a rewrite of the whole index on every pass into one write per row per
  three days.
- **Expiry, not feed-diff,** for scraped sources: a board listing lives 14–21 days past
  its last sighting; a post's clock starts on the day it was written.
- **Withheld sources** are refused by name, so old raw rows from a withdrawn source can
  never be imported again.
- **Closed stays closed.** A row closed by a quality gate (seeker post, classified ad,
  course, dead link) is never reopened by a later import of the same posting.
- **Pacing.** Writes go in chunks and the importer idles for as long as its last write
  took, so a bulk import cannot starve search on a small database.

## Decompose — `packages/core`

`decompose()` in `src/decompose.ts` turns title + description into structured fields.
Pure functions: no I/O, no model, deterministic, and fast enough to re-run over the whole
index (`pnpm redecompose`).

| field | how |
|---|---|
| language | script detection; Hebrew is normalised first (`normalize.ts`: niqqud, gender forms, final letters) |
| function | weighted cues per function in `data/functions.ts`, title first |
| seniority | title cues, then years of experience from the text |
| location / remote | the city gazetteer in `data/locations.ts`, plus "abroad" detection |
| skills | exact matching against `data/skills.ts` and `data/business-skills.ts`, with aliases, Hebrew forms and plurals |
| agency | known agency names and agency phrasing in `data/agencies.ts` |
| salary | parsed when stated; never guessed |

Every inferred field carries a confidence. Then two gates:

- **Tech gate** (`isTech` in `data/functions.ts`): technical functions always pass;
  business functions (sales, marketing, finance, HR...) pass only at a tech employer.
  Some sources grant that context (a tech-only feed); a general board does not.
- **Non-vacancy gate** (`seeker.ts`): social posts that are a person looking for work,
  a freelancer's advert, a course, a question or a classified ad are rejected with a
  reason.

Duplicates share a **fingerprint** — company + normalised title + city. A nightly
`dedupe_open_jobs()` closes all but one open job per fingerprint. (Hashing the excerpt
was tried first and grouped different jobs that shared an "about us" paragraph.)

## Store — Supabase

`supabase/migrations/` is the full schema, in order. The main tables:

| table | holds |
|---|---|
| `companies` | employers, their ATS provider and token, and crawl state (`next_run_at`, `lease_until`, `fail_count`) |
| `jobs` | every posting with its decomposed columns, `status` (`draft` / `open` / `closed`), `quality_flags`, `expires_at`, a generated `search_tsv` |
| `sources` | non-ATS sources, e.g. Facebook groups with `review_state` and per-group caps |
| `raw_pages`, `raw_posts` | fetched content awaiting import, with retention |
| `runs`, `metrics`, `events` | operational history |
| `profiles`, `resumes`, `saved_jobs`, `consents` | user data, owner-only under RLS |
| `campaigns` and friends | the optional paid-placement area |

Row-level security is on everywhere. The public reads through `SECURITY DEFINER`
functions that return only open jobs; anything personal is filtered on `auth.uid()`.
Migration `0055` asserts that no other definer function is executable anonymously, so a
forgotten `revoke` fails the migration instead of shipping.

`pg_cron` runs the housekeeping inside the database: hourly expiry, nightly dedupe,
raw-cache purge, daily metrics, and ending paid campaigns every 15 minutes.

The production instance was small, and its limit was CPU, not size: the anonymous
role's 3-second statement timeout was the real budget for every search. That is why
bulk writes are paced and why search is one well-indexed SQL function rather than
several queries — constraints that shaped the code, and that the code still carries.

## Serve — `apps/web`

Next.js 16 App Router, React 19, Tailwind 4.

- `/jobs` — search. `search_jobs()`, `search_jobs_count()` and `search_facets()` do
  full-text search (`tsvector`), trigram matching on titles and companies, filters,
  and ranking in one round trip each.
- `/jobs/[id]` — a job page with a link to apply on the employer's own site. No
  applications are taken on Jobsworm's behalf.
- `/match` — upload a CV. `packages/core/src/cv.ts` splits it into sections, weights
  recent experience, and extracts skills with the same matcher the decomposer uses;
  matches come back with "why" chips (`match-why.ts`). The CV is read in the browser
  first and uploaded as bytes, which is what makes files from Google Drive work.
- `/me` — saved jobs, profile and CV, and one-click account deletion.
- `/recruit`, `/admin` — the optional paid-placement area: recruiters post jobs,
  listings are reviewed, paid through fungies.io and labelled as sponsored. Without
  `FUNGIES_*` configured it degrades to invoice-only.
- Sign-in is passwordless: a 6-digit email code through Supabase Auth.
- Consent at signup is versioned and the exact text is hashed into the consent record
  (`lib/consent.ts`), so it is provable later what a user agreed to.

## Scheduling, as it ran

The timetable the live deployment used. The published workflows ship with their
`schedule:` triggers removed and `workflow_dispatch` only, so nothing fires in a
clone; this is the shape to put back once your own secrets are in place.

| what | where | when (UTC) |
|---|---|---|
| ATS ingest, 4 large passes | Vercel Cron | 00:00, 00:10, 00:20, 00:30 |
| ATS ingest, small pass | Vercel Cron | hourly at :07 |
| PostHog rollup | Vercel Cron | hourly at :17 |
| free sources + linkcheck + import | GitHub Actions `scrape.yml` | 05:17 and 17:17 |
| Apify Facebook sweep + import | GitHub Actions `social.yml` | 05:23 every second day |
| company discovery | GitHub Actions `discover.yml` | Mondays 06:00 |
| gate-drift audit (report only) | GitHub Actions `gate-drift.yml` | Mondays 04:00 |
| expiry; dedupe, raw-cache purge, metrics | `pg_cron` | hourly; nightly 23:50–03:50 |

The heavy work is kept out of each other's way: database jobs own roughly 00:00–04:00,
scrapes start after 05:00, and `scrape.yml` and `social.yml` share a concurrency group
so they never write at the same time.

## "PLAN.md §…" in the comments

Comments throughout the code cite sections of `PLAN.md`, the project's original design
document. It is not part of this repository. What the cited sections covered, and where
that lives now:

| cited section | topic | see |
|---|---|---|
| §3 | data model | `supabase/migrations/0003_core.sql`, `0004_people.sql`; *Store* above |
| §4.1 | seed companies | `scripts/seed/`, `data/seed-report.md` |
| §4.2 | ATS feeds and the ingest loop | `packages/adapters`; *ATS feeds* above |
| §4.3 | social sources: public groups only, no login, poster hashing | `apps/worker/.../sources/facebook.py`; [data-sources-and-legal.md](data-sources-and-legal.md) |
| §4.4 | Israeli job boards | withdrawn; [data-sources-and-legal.md](data-sources-and-legal.md) |
| §4.5 | the tech-only gate | `packages/core/src/data/functions.ts` |
| §4.7 | the fetch ladder and per-domain politeness | `apps/worker/jobswarm_scrape/ladder.py` |
| §5 | decomposition schema and field rules | `packages/core/src/decompose.ts`, `types.ts` |
| §6 | search | `search_jobs()` in the migrations |
| §8, §12 | profile, consent, Israeli privacy law (Amendment 13) | `apps/web/lib/consent.ts`, the privacy page |
| §13 | no paid model at runtime; rules and dictionaries instead | `packages/core` |
