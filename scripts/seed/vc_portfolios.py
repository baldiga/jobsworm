#!/usr/bin/env python3
"""
vc_portfolios.py — harvest candidate company domains from Israeli VC
portfolio pages, so `detect_ats.py` has something to probe.

## Why the portfolio page and not the VC's job board

Most Israeli VCs run their careers board on Getro or Consider, and both
prohibit it in terms: Getro bans "crawls, scrapes, or spiders any page, data,
or portion of ... the Services or Content" and separately bans reproducing or
distributing Content; Consider adds "your own internal business use" and a
competitor clause, behind a CSRF token that would have to be deliberately
defeated. Those boards are off limits, and the fact that their endpoints
answer unauthenticated does not change it.

The PORTFOLIO page is a different thing on a different domain: the firm's own
marketing, listing the companies it has invested in, published to be read. We
take company names and domains from it — facts, not the curated compilation
that Getro built — and then go to each company's own ATS, which is where the
job actually lives and where the employer published it to be aggregated.

So the flow is: portfolio page -> company domain -> detect_ats.py -> the
company's own board. The VC is a directory, never a source of listings.

## Yield, measured 2026-09-11

86 candidates from two portfolio pages produced 10 ATS boards and 25 Israeli
jobs: about 12% of domains have a detectable board, and about 2.5 Israeli jobs
each. Useful, and not a shortcut to a large index — 0.29 Israeli jobs per
candidate domain is the number to plan with.

    python scripts/seed/vc_portfolios.py --out candidates.txt
    python scripts/seed/detect_ats.py --companies candidates.txt --out found.json
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys

import httpx

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)

# Israeli funds whose portfolio pages are server-rendered. A JS-only page
# yields nothing here and is simply skipped rather than special-cased: the
# point is breadth of candidates, and there are more funds than time.
PORTFOLIO_PAGES: tuple[str, ...] = (
    "https://www.glilotcapital.com/portfolio/",
    "https://tlv.partners/portfolio/",
    "https://www.grove.vc/portfolio",
    "https://www.entree.vc/portfolio",
    "https://www.83north.com/portfolio",
    "https://vintageinvestments.com/portfolio/",
    "https://www.team8.vc/portfolio",
    "https://hetz.vc/portfolio",
    "https://www.aleph.vc/portfolio",
    "https://www.pitango.com/portfolio/",
    "https://www.viola-group.com/portfolio/",
    "https://stageonevc.com/portfolio/",
    "https://www.jvpvc.com/portfolio/",
    "https://www.magmavc.com/portfolio",
    "https://www.qumra.com/portfolio",
    "https://www.redpoint.com/portfolio/",
)

DOMAIN_RE = re.compile(
    r"https?://(?:www\.)?([a-z0-9][a-z0-9-]{1,40}\.(?:com|io|ai|co\.il|net|tech|dev))",
    re.I,
)

# The funds themselves, the usual CDN and social noise, and anything that is
# plainly not a portfolio company.
SKIP = re.compile(
    r"(glilotcapital|tlv\.partners|grove\.vc|entree\.vc|83north|vintageinvestments"
    r"|team8|hetz\.vc|aleph\.vc|pitango|viola-group|stageonevc|jvpvc|magmavc"
    r"|qumra|redpoint|getro|consider\.com"
    r"|linkedin|twitter|x\.com|facebook|youtube|instagram|medium\.com|crunchbase"
    r"|google|gstatic|googleapis|cloudflare|jquery|bootstrapcdn|fontawesome"
    r"|gravatar|wixstatic|wix\.com|squarespace|webflow|wordpress|wp\.com"
    r"|w3\.org|schema\.org|apple\.com|adobe\.com|vimeo|typekit|hubspot"
    r"|calendly|mailchimp|sentry|cookiebot|osano|sharethis|addthis)",
    re.I,
)


async def fetch(client: httpx.AsyncClient, url: str) -> str:
    try:
        r = await client.get(url, follow_redirects=True, timeout=25)
        return r.text if r.status_code == 200 else ""
    except Exception as exc:  # noqa: BLE001 - one dead fund must not stop the sweep
        print(f"  {url}: {type(exc).__name__}", file=sys.stderr)
        return ""


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="vc_candidates.txt")
    args = ap.parse_args()

    found: set[str] = set()
    async with httpx.AsyncClient(headers={"User-Agent": UA}) as client:
        pages = await asyncio.gather(*(fetch(client, u) for u in PORTFOLIO_PAGES))
        for url, html in zip(PORTFOLIO_PAGES, pages):
            hits = {m.group(1).lower() for m in DOMAIN_RE.finditer(html or "")}
            hits = {d for d in hits if not SKIP.search(d)}
            print(f"  {len(hits):4d}  {url}")
            found |= hits

    lines = [f"{d.split('.')[0]} | {d}" for d in sorted(found)]
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"\n{len(found)} candidate domains -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
