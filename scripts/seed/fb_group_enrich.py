#!/usr/bin/env python3
"""
fb_group_enrich.py — read each candidate group's About page and record what it
actually is: real name, public or private, how many members.

## Why this is a separate pass

`fb_group_search.py` returns what a search index knows, and a search index
cannot say whether a group is public. Roughly a quarter of its titles are not
even group names — Brave returns permalinks, so the "title" is the text of
whatever post it matched. Neither is good enough to approve a source on.

This asks Facebook directly, once per group, and writes down the answer.

## Logged out, on purpose

`assert_public()` in facebook_session.py does the same check with a cookie,
because the reader it guards is a logged-in reader. This does not need one:
m.facebook.com serves the About page to anybody, and it states the privacy and
the member count. Verified 2026-09-14 — israel.hitech.jobs came back public and
sec4cyber private, both without a session.

That matters beyond convenience. Checking 307 groups with the account is 307
requests of account risk spent on groups we have not even decided to read;
logged out there is no account to lose. The cookie stays for the one job that
genuinely needs it.

The headers are not optional. Facebook answers HTTP 400 to a bare request —
that is the trap DECISIONS.md records for mbasic — so this sends the same
header set the session module uses.

## Pacing

One request at a time, 6-12 seconds apart, exactly as facebook_session.py
does. 307 groups is therefore about three quarters of an hour, and that is the
right speed: bursts are what get addresses blocked.

    python scripts/seed/fb_group_enrich.py --in data/fb_candidates.json \\
        --out data/fb_enriched.json
"""

from __future__ import annotations

import argparse
import asyncio
import html as htmllib
import json
import random
import re
import sys

import httpx

MOBILE_BASE = "https://m.facebook.com"
MOBILE_UA = (
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
)
HEADERS = {
    "User-Agent": MOBILE_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
}

MIN_DELAY, MAX_DELAY = 6.0, 12.0

PUBLIC_MARKERS = ("קבוצה ציבורית", "Public group", "Public · ", "ציבורית ·")
PRIVATE_MARKERS = ("קבוצה פרטית", "Private group", "פרטית ·")

GROUP_RE = re.compile(r"groups/([^/?]+)")

# The member count is not next to its own label in the markup.
#
# m.facebook.com lays the About header out with absolute positioning, so the
# number and the words "חברים בקבוצה" are separate spans and the NUMBER COMES
# FIRST, a few hundred characters earlier. There is no member_count in the
# payload and no "N members" string anywhere, which is why every obvious regex
# returned nothing on the first run.
#
# So: find the label, then take the closest number-shaped span before it. The
# count is abbreviated on this surface ("90K"), so it is approximate by
# construction — fine, since it only ranks which groups are worth crawling.
MEMBER_LABEL = re.compile(r"(חברים בקבוצה|members in group|total members|members)", re.I)
NUM_SPAN = re.compile(r">\s*([\d][\d.,]*)\s*([KkMm])?\s*<")


def slug_of(url: str) -> str:
    m = GROUP_RE.search(url or "")
    return m.group(1).lower() if m else ""


def parse_about(page: str) -> dict:
    """What the About page says. Missing fields come back as None, not guesses."""
    head = page[:200_000]

    is_public = any(m in head for m in PUBLIC_MARKERS)
    is_private = any(m in head for m in PRIVATE_MARKERS)
    # Both or neither means we could not tell, and "could not tell" is not
    # "public" — the same fail-closed rule assert_public() uses.
    privacy = "public" if (is_public and not is_private) else (
        "private" if is_private else "unknown"
    )

    name = None
    m = re.search(r'<title[^>]*>(.*?)</title>', head, re.S)
    if m:
        name = htmllib.unescape(re.sub(r"\s+", " ", m.group(1))).strip()
        for suffix in (" | Facebook", " - Facebook", " | פייסבוק"):
            if name.endswith(suffix):
                name = name[: -len(suffix)].strip()
        if name.lower() in ("facebook", "error", "log in or sign up to view"):
            name = None

    members = None
    label = MEMBER_LABEL.search(head)
    if label:
        # The number sits before the label, not after it: take the closest
        # number-shaped span in the 1500 characters preceding it.
        window = head[max(0, label.start() - 1500): label.start()]
        spans = NUM_SPAN.findall(window)
        if spans:
            raw, suffix = spans[-1]
            try:
                n = float(raw.replace(",", ""))
                members = int(n * {"k": 1_000, "m": 1_000_000}.get(suffix.lower(), 1))
            except ValueError:
                members = None

    return {"privacy": privacy, "name": name, "members": members}


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--min-delay", type=float, default=MIN_DELAY)
    ap.add_argument("--max-delay", type=float, default=MAX_DELAY)
    args = ap.parse_args()

    with open(args.inp, encoding="utf-8") as fh:
        payload = json.load(fh)
    cands = payload["results"] if isinstance(payload, dict) else payload
    if args.limit:
        cands = cands[: args.limit]

    out: list[dict] = []
    counts = {"public": 0, "private": 0, "unknown": 0, "error": 0}

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for i, c in enumerate(cands, 1):
            slug = slug_of(c.get("url", ""))
            if not slug:
                continue
            row = {**c, "slug": slug}
            try:
                r = await client.get(
                    f"{MOBILE_BASE}/groups/{slug}/about/", headers=HEADERS, timeout=25.0
                )
                if r.status_code != 200:
                    row.update(privacy="error", http=r.status_code)
                    counts["error"] += 1
                else:
                    row.update(parse_about(r.text), http=200)
                    counts[row["privacy"]] += 1
            except Exception as e:  # noqa: BLE001 - one bad group must not end the run
                row.update(privacy="error", http=None, error=type(e).__name__)
                counts["error"] += 1

            out.append(row)
            if i % 10 == 0 or i == len(cands):
                print(f"  [{i}/{len(cands)}] {counts}", file=sys.stderr, flush=True)
            if i < len(cands):
                await asyncio.sleep(random.uniform(args.min_delay, args.max_delay))

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"counts": counts, "results": out}, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    print(f"\n{counts}", file=sys.stderr)
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
