# Lessons learned

Things that went wrong, or nearly did, while building and running Jobsworm — kept
because most of them will happen to anyone building something similar. Each one is also
recorded at the point in the code it applies to, usually in a comment that starts with
the bug.

## Data sources

**A permissive `robots.txt` is not permission.** Every Israeli job board checked has a
clause in its terms forbidding republication of its listings — including one whose
`robots.txt` reads `Allow: /`. For a job board the listings are the product, so this is
boilerplate. `robots.txt` answers "will I be blocked"; the terms answer "may I publish
this". Read the terms before writing a scraper, and drop the source if they say no.

**A subdomain is not a separate legal entity.** One board's jobs subdomain had a
terms page that was an unfilled theme placeholder, and that was taken as "no terms". The
operator's real terms lived on the parent domain and named the job listings explicitly.

**Buying data from a vendor does not change what you may do with it.** Content bought
from a scraping marketplace is still covered by the platform's own terms. LinkedIn's
User Agreement forbids distributing content obtained from the service "directly or
through third parties", which is why LinkedIn is not a source here. And "it already
ships" is never evidence of permission.

**Withhold, don't delete, and don't close.** When a source is withdrawn, move its
listings to `draft` with a `source_withheld` flag. Draft is invisible to every search the instant it is
written and reversible with one `UPDATE`. Closing them would have told seekers the jobs
had ended, when what ended was our right to show them. Then refuse the source by name in
the importer, the worker and the workflow, because any one of them alone lets it back in.

**Find the open doors.** Employers' own ATS feeds exist to be read, and became more than
half the index. Cloudflare's `Content-Signal: search=yes` in a `robots.txt` is an
explicit, machine-readable grant to build a search index with links and excerpts.
Workable is the one ATS vendor that runs a public board across all its customers.

**Measure a source before trusting it.** Facebook's public group page shows two or three
posts to a logged-out visitor, whatever the URL variant — 0.44 job posts per group
across 25 groups. Individual post permalinks, found through a search API, render in full
and carry no byline. Volume moved from feeds to search overnight. Search for roles
("דרוש/ה מפתח full stack"), not industries: "הייטק" matches "a hi-tech company" and returns
receptionists.

**Pagination that isn't.** Workable's board API caps every answer at 20 and ignores
every offset parameter. Partitioning the query space (24 cities × 24 role words, unioned
by id) reached 115 of 131 jobs. Its `location` parameter ranks rather than filters, so
every row is re-checked for the country.

## Money

**The billed price is not the listed price.** Two Apify actors listed at $1.50 and $2.60
per 1,000 results billed $1.65 and $5–7. An automatic failover onto the dearer one spent
a whole $19 monthly plan in one afternoon. The dearer actor is now never selected
automatically, and changing the default is treated as a budget decision.

**A dry run must not cost money.** `fb-apify --dry-run` used to start the paid actor and
only skip the database write. Apify bills for every post returned, stored or not. It now
prints what would run and an upper bound on the cost, and starts nothing.

**Every rejected result is still billed.** Filtering by keyword at the vendor neither
worked as documented nor saved money, so the code takes the whole recent window and
applies its own gate — and only asks for posts newer than the last sweep.

## Database

**`revoke ... from anon, authenticated` does nothing if `PUBLIC` holds the grant** — and
in Postgres, `PUBLIC` holds `EXECUTE` on every new function by default. A function meant
to be service-role only could be called by any visitor to inflate counters; a matcher
meant to answer only about the caller could be asked about anyone, leaking the overlap
between their CV and each job. The fix is `revoke ... from public`. The lasting fix is a
migration that **asserts** the property: `0055` fails if any `SECURITY DEFINER` function
executable by `anon` is missing from an explicit allow-list. The bug was found because
an earlier assertion failed on the way in.

**A small instance runs out of CPU long before disk.** The anonymous role's 3-second
statement timeout is the real budget for a search. A bulk import that rewrote ~4,800
unchanged rows four times a day took search down twice. A content hash now skips
unchanged rows, writes are paced (the importer idles for as long as its last write
took), and heavy jobs are scheduled apart from each other.

**An upsert can undo your cleanup.** The importer wrote `status: 'open'` on every row it
saw, so posts a quality gate had deliberately closed reopened on the next pass. Closed
rows with a rejection flag are now excluded from writes.

**Measure the duplicate problem before solving it.** The report was "two boards list the
same job". The data said cross-source duplicates were 1 listing in 6,461; same-source
duplicates (an ATS issuing a new id for a reposted role) were 508. Hashing the excerpt
to find them grouped different jobs that shared an "about us" paragraph. Company +
normalised title + city is the honest key.

## Text and matching

**Measure a dictionary change over the whole corpus, and count losses.** A new
"distributed computing" skill silently took 286 jobs away from "distributed systems".
Adding it as an alias instead fixed that; together with plural matching and ten new
skills, the change gave 933 jobs a new skill and took none away. The method:
re-extract every stored job before and after the change, and diff per job.

**Your matcher may not match plurals.** A lookahead that stopped "Java" matching
"JavaScript" also stopped "data pipeline" matching "data pipelines". Generate plural
variants for multi-word terms instead of loosening the boundary.

**Mine your own corpus before importing a taxonomy.** ESCO is free and has 14,000
skills, but its labels are verb phrases ("manage payroll"), it lacks acronyms like IFRS
and frameworks younger than its release cycle, and it has no Hebrew. Reading the words
that follow "experience with" / "ניסיון ב" in 4,500 real job ads found what was missing,
including a framework eleven employers wanted.

**`\b` is satisfied by a hyphen.** `\bour\s+client\b` matched "our client-side SDK" and
flagged ordinary engineering copy as staffing-agency language.

## The web app

**A blank environment variable is not an unset one.** `process.env.X ?? fallback` passes
an empty string straight through; `new URL("")` then throws in the root layout and every
page fails. Use `?.trim() || fallback`.

**One fact, one definition.** After a domain rename, the canonical URL was defined in
three files with three different fallbacks; the sitemap listed every job at an address
that redirected. It now lives in `lib/site.ts`.

**Files from Google Drive fail mid-upload.** A `File` backed by a cloud provider can
error while `fetch` streams it. Read it into memory with `arrayBuffer()` first and send
the bytes; show a clear hint if even that fails.

**"Not clickable" can mean "too small".** Footer links reported as broken on phones were
22 pixels tall. The markup was fine; the tap target was half the 44-pixel minimum.

## Auth (Supabase)

- **The redirect allow-list fails silently.** An `emailRedirectTo` that is not on the
  list is replaced by the Site URL without an error. After a domain rename, sign-in
  links stranded people on the old domain.
- **The email template decides code or link,** not the client. A form asking for a
  6-digit code is useless if the template only sends `{{ .ConfirmationURL }}`, or if
  OTP length is set to 8.
- **Every new code cancels the previous one,** and Supabase answers `otp_expired` for
  wrong, old and superseded codes alike. A form that says "expired, request a new one"
  sends people round in circles. Remember the last send across reloads and tell them
  only the newest email's code works.
- **Email rate limits reject signups before the user row exists,** so the people who
  were blocked leave no trace and the flow looks healthy. Count signups per hour.
- **Never `supabase config push` to a live project.** A pull cannot read the SMTP
  password, so pull-then-push disables custom SMTP and resets the Site URL.

## Operations

**Silent failure is the default.** Scheduled scrapes died two minutes in for a week and
looked exactly like runs that never started. Every scraper step continues on error by
design, so the importer exits non-zero when no source produced anything at all, and a
failed run messages the operator.

**CI must compile everything that runs.** The web build typechecks only what the web app
imports. A syntax error in the importer passed CI and was found by a scheduled job that
had already paid for its data. `pnpm typecheck` covers the rest.

## Product and privacy

**Make the important promise structural.** "Organic ranking cannot be bought" is
enforced by construction: the search functions were byte-identical before and after
paid placement shipped, and sponsored cards come from a separate function the ranking
code cannot see.

**Purpose limits apply to derived data.** A public view counter is built only from the
anonymous event stream, never from signed-in users' saves, because those were collected
under a consent that names search, matching and alerts. A public save count would need a
new consent version first.

**Webhook money rules.** Verify the signature against the raw body. Record the event
before acting on it, keyed on the provider's idempotency key, so a replay is a harmless
conflict. Return 500 only when the record could not be written, because a 500 is what
makes the provider retry. Store payments you cannot match; they are still somebody's
money. And check whether `livemode` means the opposite of `testMode` before treating
them as aliases.
