#!/usr/bin/env python3
"""
fb_group_search.py — sweep the search index for Israeli hiring groups on
Facebook, and write the new ones out as candidates for approval.

## Why this exists

`fb-discover` loads a JSON file; nothing has ever produced one automatically.
Its docstring says "discovery itself is a Claude Code session", and the record
bears that out — of the 77 candidates in data/social_sources.json, 68 came from
a model listing groups it already knew and 9 from a single DuckDuckGo pass. One
search-engine query, essentially, and it returned nine groups.

Meanwhile Facebook is 43% of the open index (1,874 of 4,313 jobs on
2026-09-14) and a productive group averages eight open jobs. It is the biggest
seam we have and it was mined by hand, once.

## Why Brave and not Google

The obvious query is `דרושים site:facebook.com`, and it is the right query.
Google is the wrong way to run it: PLAN.md 4.3 says never to scrape Google
SERPs directly, their terms prohibit automated access, and it starts answering
CAPTCHAs within a few dozen queries. Brave sells the same index through an API
with 2,000 free queries a month — far more than this needs — and `serp.py`
already speaks it, rate limit and all.

## What it does NOT decide

Nothing. A search result cannot be trusted for whether a group is public, so
every hit lands as a *candidate*; a human approves, and `assert_public()` still
checks again at read time. This only answers "which groups exist that we have
never looked at".

    python scripts/seed/fb_group_search.py --out data/fb_candidates.json
    python -m jobswarm_scrape.cli fb-discover --file data/fb_candidates.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "apps", "worker"))

from jobswarm_scrape import serp  # noqa: E402

GROUP_RE = re.compile(r"facebook\.com/groups/([A-Za-z0-9._-]+)", re.I)

# Facebook's own paths under /groups/, not groups themselves.
NOT_A_GROUP = {"create", "discover", "feed", "search", "browse", "your_groups", "joins"}


QUERIES_HE = [
    "דרושים site:facebook.com/groups",
    "דרושים הייטק site:facebook.com/groups",
    "משרות הייטק site:facebook.com/groups",
    "דרושים מתכנתים site:facebook.com/groups",
    "דרושים מפתחים site:facebook.com/groups",
    "משרות תוכנה site:facebook.com/groups",
    "דרושים QA בדיקות תוכנה site:facebook.com/groups",
    "דרושים DevOps site:facebook.com/groups",
    "דרושים דאטה אנליסט site:facebook.com/groups",
    "דרושים סייבר אבטחת מידע site:facebook.com/groups",
    "דרושים אלגוריתמים site:facebook.com/groups",
    "דרושים חומרה אלקטרוניקה site:facebook.com/groups",
    "דרושים מוצר פרודקט site:facebook.com/groups",
    "דרושים UX UI site:facebook.com/groups",
    "דרושים שיווק דיגיטלי site:facebook.com/groups",
    "דרושים מכירות הייטק site:facebook.com/groups",
    "דרושים כספים חשבונאות הייטק site:facebook.com/groups",
    "דרושים משאבי אנוש גיוס site:facebook.com/groups",
    "קבוצת דרושים תל אביב site:facebook.com/groups",
    "קבוצת דרושים חיפה site:facebook.com/groups",
    "קבוצת דרושים ירושלים site:facebook.com/groups",
    "קבוצת דרושים באר שבע site:facebook.com/groups",
    "דרושים מרכז השרון site:facebook.com/groups",
    "משרות סטארטאפ site:facebook.com/groups",
    "דרושים ג'וניור הייטק site:facebook.com/groups",
    "דרושים סטודנטים הייטק site:facebook.com/groups",
    "דרושים עבודה מהבית הייטק site:facebook.com/groups",
    "לוח דרושים הייטק site:facebook.com/groups",
]

QUERIES_EN = [
    "israel tech jobs site:facebook.com/groups",
    "israel hitech jobs site:facebook.com/groups",
    "tel aviv jobs site:facebook.com/groups",
    "israel startup jobs site:facebook.com/groups",
    "israel developers jobs site:facebook.com/groups",
    "israel QA jobs site:facebook.com/groups",
    "israel devops jobs site:facebook.com/groups",
    "israel data science jobs site:facebook.com/groups",
    "israel cyber security jobs site:facebook.com/groups",
    "israel product manager jobs site:facebook.com/groups",
    "israel marketing jobs site:facebook.com/groups",
    "olim jobs israel site:facebook.com/groups",
    "english speaking jobs israel site:facebook.com/groups",
    "remote jobs israel site:facebook.com/groups",
    "israel job board group site:facebook.com/groups",
]

# Words in a group's title that mark it as worth a closer look. Only used to
# sort the output — nothing is discarded on this basis, because a group called
# "קהילת המפתחים" carries jobs without saying so.
CORE_CUES = ["הייטק", "hitech", "high tech", "tech", "מתכנת", "developer", "תוכנה",
             "software", "qa", "devops", "דאטה", "data", "סייבר", "cyber",
             "אלגוריתמ", "product", "מוצר", "ux", "ui", "סטארטאפ", "startup"]
JOB_CUES = ["דרוש", "משרות", "משרה", "job", "jobs", "career", "קריירה", "גיוס",
            "hiring", "vacanc", "עבודה", "לוח"]


def tier_of(title: str) -> str:
    t = (title or "").lower()
    has_job = any(c in t for c in JOB_CUES)
    has_core = any(c in t for c in CORE_CUES)
    if has_job and has_core:
        return "core"
    if has_core:
        return "adjacent"
    return "broad"


def known_slugs() -> set[str]:
    """Every group we have already seen, so the output is only what is new."""
    seen: set[str] = set()
    path = os.path.join(ROOT, "data", "social_sources.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
        for r in (payload.get("results") if isinstance(payload, dict) else payload) or []:
            m = GROUP_RE.search(str(r.get("url") or ""))
            if m:
                seen.add(m.group(1).lower())
    return seen


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "fb_candidates.json"))
    ap.add_argument("--count", type=int, default=20, help="results per query")
    ap.add_argument("--only", choices=["he", "en", "both"], default="both")
    ap.add_argument("--limit-queries", type=int, help="cap queries, for a cheap trial run")
    args = ap.parse_args()

    queries = []
    if args.only in ("he", "both"):
        queries += QUERIES_HE
    if args.only in ("en", "both"):
        queries += QUERIES_EN
    if args.limit_queries:
        queries = queries[: args.limit_queries]

    print(f"backend        : {serp.backend_name()}", file=sys.stderr)
    print(f"queries        : {len(queries)}", file=sys.stderr)

    known = known_slugs()
    print(f"already known  : {len(known)}", file=sys.stderr)

    found: dict[str, dict] = {}
    failed: list[str] = []

    for i, q in enumerate(queries, 1):
        try:
            hits = await serp.search(q, count=args.count)
        except serp.SerpUnavailable as e:
            failed.append(f"{q}: {e}")
            continue
        new_here = 0
        for h in hits:
            m = GROUP_RE.search(h.url)
            if not m:
                continue
            slug = m.group(1).lower()
            if slug in NOT_A_GROUP or slug in known or slug in found:
                continue
            title = (h.title or "").replace(" | Facebook", "").strip()
            found[slug] = {
                "title": title,
                "url": f"https://www.facebook.com/groups/{slug}/",
                "tier": tier_of(f"{title} {h.snippet}"),
                "query": q,
            }
            new_here += 1
        print(f"  [{i:>3}/{len(queries)}] +{new_here:<3} {q[:56]}", file=sys.stderr, flush=True)

    results = sorted(
        found.values(),
        key=lambda r: ({"core": 0, "adjacent": 1, "broad": 2}[r["tier"]], r["title"]),
    )
    counts = {t: sum(1 for r in results if r["tier"] == t) for t in ("core", "adjacent", "broad")}

    payload = {
        "discovered_at": date.today().isoformat(),
        "note": (
            "Candidates only, from a Brave search sweep. Privacy is NOT verified here — "
            "a search result cannot say whether a group is public. Approve in the sources "
            "table before ingesting; assert_public() checks again at read time."
        ),
        "counts": counts,
        "results": results,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    print(f"\nnew groups     : {len(results)}  {counts}", file=sys.stderr)
    if failed:
        print(f"failed queries : {len(failed)}", file=sys.stderr)
        for f in failed[:5]:
            print(f"  {f}", file=sys.stderr)
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
