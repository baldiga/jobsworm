"""Jobsworm scraping worker.

Implements the escalation ladder from PLAN.md section 4.7 and the supplementary
sources from 4.3 and 4.4. Fetching happens here, in Python, because the
anti-bot tooling lives in Python. Decomposition stays in TypeScript
(`packages/core`) so there is exactly one implementation of the rules, the
dictionaries and the tech-only gate.

The handoff is the `raw_pages` / `raw_posts` tables: this worker writes parsed
postings there, and `pnpm import:scraped` decomposes and upserts them.
"""

__version__ = "0.1.0"
