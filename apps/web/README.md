# apps/web

The Jobsworm site: Next.js 16 App Router, React 19, Tailwind 4, over Supabase.

Run it from the repository root, not from here — the setup (local Supabase, env files,
seeding) is in the root [README](../../README.md#build-your-own):

```bash
pnpm dev                    # from the repo root
```

This app reads its environment from `apps/web/.env.local`, separately from the root
`.env.local` the pipeline uses; copy the root file here after filling it in.

Where things are:

- `app/` — routes. `/jobs` search, `/jobs/[id]` job pages, `/match` CV matching, `/me`
  the signed-in area, `/recruit` and `/admin` the optional paid-placement area,
  `/api/cron/*` the scheduled ingest.
- `components/` — UI. `components/ui/` holds the primitives.
- `lib/` — data access and helpers. `site.ts` and `contact.ts` hold the deployment's
  identity; `consent.ts` the versioned signup consent text.

How the pieces fit together: [docs/architecture.md](../../docs/architecture.md).
