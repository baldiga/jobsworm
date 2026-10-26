# Security policy

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability reporting:
the **Security** tab of this repository, then **Report a vulnerability**. Only the
maintainer sees the report.

Include what you found, how to reproduce it, and what an attacker could do with it.
You will get an acknowledgement as soon as the maintainer sees it; this is a
best-effort project, so please allow a few days.

## What is in scope

This repository's code, and nothing else: the web app, API routes, Supabase
migrations and row-level-security policies, the ingest pipeline and the worker.

**There is no live deployment.** The site at jobsworm.fun was retired in October 2026
and its database deleted; the domain now redirects here. Do not scan, load-test or
otherwise attack anything at that name — whatever answers it is not this project.

Out of scope: third-party services the project used (Supabase, Vercel, Apify, PostHog,
fungies) — report those to their vendors. Also out of scope: anybody else's
deployment of this code. If you find an issue in a site someone else built from this
repository, tell them, not us; but if the cause is a bug in this code, we want to
hear about it.

## Things this project already treats as security bugs

- any Postgres function executable by `anon` that can read or change another user's
  data. `SECURITY DEFINER` functions callable anonymously are allow-listed in
  `supabase/migrations/0055_lock_remaining_definers.sql`;
- any route that returns personal data (CVs, saved jobs, profiles, consent records)
  to someone other than its owner;
- secrets in the repository or its history. The repository is scanned on every push;
  if you spot one anyway, report it privately.

## If you run your own deployment

You are responsible for its security. Keep `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`
and every provider key server-side only — never with a `NEXT_PUBLIC_` prefix — and
rotate any key that has been pasted into a chat, an issue or a log.
