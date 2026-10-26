#!/usr/bin/env python3
"""
resolve_domains.py — turn company NAMES into company domains, so detect_ats has
something to probe.

A job-title export gives a company name and nothing else. `detect_ats` needs a
domain. This bridges the two the same way `merge_seed.py` does for
search-harvested tokens: derive plausible hostnames from the name, ask each one
with a cheap request, and keep the first that actually serves a page.

It is a guess with a verification step, not a lookup, so it is deliberately
strict about what counts as a hit:

  * The response must be 200-399. A parked domain that 404s is not the company.
  * A redirect to a completely different registrable domain is followed and the
    destination recorded, because `nvidia.co.il -> nvidia.com` is the answer we
    want, but a redirect to a domain reseller is not.
  * Names that are obviously not companies are dropped before any request:
    "Confidential Careers" and friends are placeholders in these exports.

Nothing here touches the database, and every request is to a company's own
front page.

    python scripts/seed/resolve_domains.py --in names.tsv --out resolved.txt \\
        --concurrency 8
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys

import httpx

HEADERS = {
    # Point the bot's identifying URL at the source, not at the retired site's
    # /about, which was never a route and 404s.
    "User-Agent": "Mozilla/5.0 (compatible; JobswormBot/1.0; +https://github.com/baldiga/jobsworm)",
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en,he;q=0.8",
}

TLDS = [".com", ".co.il", ".io", ".ai", ".net", ".tech", ".org", ".co"]

# Placeholders and aggregator artefacts that are never a real employer.
NOT_A_COMPANY = re.compile(
    r"^(confidential|anonymous|stealth|undisclosed|private|various|multiple|"
    r"company confidential|confidential careers|hidden|n/?a)\b",
    re.I,
)

# Words that carry no identity and hurt the guess more than they help.
NOISE = re.compile(
    r"\b(ltd|ltd\.|inc|inc\.|llc|corp|corporation|company|co|group|israel|"
    r"technologies|technology|systems|solutions|software|labs|the|and)\b",
    re.I,
)


def candidates(name: str) -> list[str]:
    """Plausible hostnames for a company name, best guess first."""
    # Many Israeli listings are "English | Hebrew"; the English half is the one
    # that resembles a domain.
    head = re.split(r"[|/(–—]", name)[0]
    head = re.sub(r"[֐-׿]+", " ", head)          # drop Hebrew
    head = NOISE.sub(" ", head)
    base = re.sub(r"[^A-Za-z0-9 ]", " ", head).strip()
    if not base:
        return []
    words = [w for w in base.split() if w]
    if not words:
        return []

    joined = "".join(words).lower()
    hyphen = "-".join(w.lower() for w in words)
    first = words[0].lower()

    stems: list[str] = [joined]
    if hyphen != joined:
        stems.append(hyphen)
    # A single distinctive first word is often the domain ("Mobileye Vision" ->
    # mobileye.com), but only when it is long enough to be distinctive.
    if len(words) > 1 and len(first) >= 5:
        stems.append(first)

    out: list[str] = []
    for stem in stems:
        if len(stem) < 3:
            continue
        for tld in TLDS:
            out.append(stem + tld)
    # Cap the fan-out: 3 stems x 8 TLDs is 24 requests per company, which is
    # more than this is worth. Best guesses only.
    return out[:10]


def registrable(host: str) -> str:
    host = host.lower().split(":")[0]
    return re.sub(r"^www\.", "", host)


async def resolve(client: httpx.AsyncClient, sem: asyncio.Semaphore,
                  name: str, tech: str, total: str) -> tuple[str, str, str, str] | None:
    for host in candidates(name):
        async with sem:
            for scheme in ("https://",):
                try:
                    r = await client.get(scheme + host, headers=HEADERS, timeout=12.0,
                                         follow_redirects=True)
                except Exception:
                    continue
                if 200 <= r.status_code < 400:
                    final = registrable(r.url.host or host)
                    # A redirect that lands on a parking page or a marketplace
                    # is not the company.
                    if any(bad in final for bad in
                           ("godaddy", "sedo", "afternic", "hugedomains",
                            "domain", "parking", "wixsite", "squarespace")):
                        continue
                    return (name, final, tech, total)
    return None


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True,
                    help="TSV: name<TAB>tech_count<TAB>total_count")
    ap.add_argument("--out", required=True)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--limit", type=int, help="only the first N names")
    args = ap.parse_args()

    rows: list[tuple[str, str, str]] = []
    with open(args.inp, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            if NOT_A_COMPANY.match(parts[0].strip()):
                continue
            rows.append((parts[0].strip(), parts[1], parts[2]))
    if args.limit:
        rows = rows[: args.limit]

    sem = asyncio.Semaphore(args.concurrency)
    seen: set[str] = set()
    found: list[tuple[str, str, str, str]] = []

    async with httpx.AsyncClient(http2=False) as client:
        tasks = [resolve(client, sem, n, t, tot) for n, t, tot in rows]
        done = 0
        for coro in asyncio.as_completed(tasks):
            got = await coro
            done += 1
            if done % 25 == 0:
                print(f"  {done}/{len(rows)} probed, {len(found)} resolved",
                      file=sys.stderr, flush=True)
            if not got:
                continue
            name, domain, tech, total = got
            if domain in seen:
                continue
            seen.add(domain)
            found.append(got)

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("# name | domain, resolved from company names by probing the\n")
        fh.write("# guessed host. Feed to detect_ats.py.\n")
        for name, domain, _tech, _total in sorted(found, key=lambda r: r[1]):
            fh.write(f"{name} | {domain}\n")

    print(f"names in       : {len(rows)}", file=sys.stderr)
    print(f"domains resolved: {len(found)}", file=sys.stderr)
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
