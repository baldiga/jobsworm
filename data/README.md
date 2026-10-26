# data/

| file | what |
|---|---|
| `companies.seed.json` | ~290 verified Israeli tech employers with their public ATS board (provider, token, feed URL). `pnpm seed` loads it. |
| `seed-report.md` | How that list was built and verified, coverage by provider, and the tokens that failed. |
| `skill_candidates.json` | Output of `scripts/seed/mine_skills.ts`: skill terms the job corpus asks for that the dictionary did not know. A proposal for a human to accept or reject, not a change. |

The ATS tokens in `companies.seed.json` are not secrets. They are the public
identifiers each employer's own careers page uses to fetch its job list, and
anyone can read them out of that page.

The dictionaries the decomposer runs on (skills, locations, functions,
agencies, title rules) are code, not data files: `packages/core/src/data/`.

## Generated, never committed

- `raw/`, `samples/`, `_seed_work*/` — intermediate scrape and enumeration output.
- `fb_*.json`, `social_sources.json` — Facebook group lists from
  `scripts/seed/fb_group_*.py`. They name third-party communities, and once
  loaded the database's `sources` table is the record, so the files stay local.
