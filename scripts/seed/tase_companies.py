#!/usr/bin/env python3
"""
tase_companies.py — turn the Tel Aviv Stock Exchange's list of listed
companies into candidate domains for `detect_ats.py`.

## Why this source

Every company on it is a public Israeli company that has to publish who it is
and where it lives. The list is TASE's own register of its listings — the
plainest kind of public fact — and the only column we take from it is the
company's own website. From there the flow is the same as everywhere else:
company domain -> detect_ats -> the employer's own ATS board, which is where
the job was published to be found.

It is also a different population from the one we already have. Our 259
companies are venture-backed product companies; this is AudioCodes, Allot,
Ormat, Elbit, Camtek — older, larger, listed, and largely absent from VC
portfolio pages. Measured against our table on 2026-09-13: 509 of the 687
listed companies publish a website, and 489 of those domains are new to us.

## What this deliberately does NOT read

The TASE file also carries a contact person's name, a street address, a phone
number, a fax number and an email address for every company. None of it is
read here, and none of it is written anywhere. We need a domain; collecting
personal contact details we have no use for because they happened to be in the
same file is how a job index turns into a marketing list.

## Order matters

Emitted hi-tech first, then financial, then the rest. The probe is paced and
may be run in slices, so the slice most likely to yield Israeli tech jobs
should be the one that runs first. Israeli banks and insurers are in the
second group on purpose — they run large in-house R&D and hire developers.

    python scripts/seed/tase_companies.py --csv tasecompanies.csv --out tase.txt
    python scripts/seed/detect_ats.py --companies tase.txt --out tase_found.json \\
        --concurrency 6
"""

from __future__ import annotations

import argparse
import csv
import re
import sys

# Column positions in the TASE export. The file has two banner rows above the
# header, so the header is row 3 and the data starts at row 4.
I_NAME, I_SECTOR, I_SITE, I_FULLNAME = 0, 1, 5, 7
DATA_START = 3

# Top-level sector prefixes, in the order we want them probed.
TIERS = [
    ("hi-tech", "הייטק"),
    ("financial", "פיננסי"),
    ("instruments", "מכשירים פיננסים"),
    ("industrial", "ריאלי"),
]


def registrable(site: str) -> str:
    """Bare host, no scheme, no www, no path. Empty string if unusable."""
    s = (site or "").strip().lower()
    if not s:
        return ""
    s = re.sub(r"^https?://", "", s)
    s = s.split("/")[0].split("?")[0]
    s = re.sub(r"^www\.", "", s).strip(" .")
    # A domain needs a dot and no whitespace; the column occasionally holds a
    # sentence like "אין אתר" (no website) or an email address.
    if not s or " " in s or "." not in s or "@" in s:
        return ""
    return s


def tier_of(sector: str) -> str:
    for label, prefix in TIERS:
        if (sector or "").startswith(prefix):
            return label
    return "other"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="TASE listed-companies export")
    ap.add_argument("--out", required=True, help="candidates file for detect_ats.py")
    ap.add_argument(
        "--tiers",
        default="hi-tech,financial",
        help="comma-separated tiers to emit, in order "
        "(hi-tech, financial, instruments, industrial, other; 'all' for everything)",
    )
    ap.add_argument("--skip-domains", help="file of domains already known, one per line or comma-separated")
    args = ap.parse_args()

    known: set[str] = set()
    if args.skip_domains:
        with open(args.skip_domains, encoding="utf-8") as fh:
            for chunk in re.split(r"[,\s]+", fh.read()):
                d = registrable(chunk)
                if d:
                    known.add(d)

    with open(args.csv, encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))

    wanted = [t.strip() for t in args.tiers.split(",") if t.strip()]
    if wanted == ["all"]:
        wanted = [label for label, _ in TIERS] + ["other"]

    buckets: dict[str, list[tuple[str, str]]] = {t: [] for t in wanted}
    seen: set[str] = set()
    skipped_known = 0
    no_site = 0

    for row in rows[DATA_START:]:
        if not any((c or "").strip() for c in row):
            continue
        domain = registrable(row[I_SITE] if len(row) > I_SITE else "")
        if not domain:
            no_site += 1
            continue
        if domain in known:
            skipped_known += 1
            continue
        if domain in seen:
            continue
        seen.add(domain)

        tier = tier_of(row[I_SECTOR] if len(row) > I_SECTOR else "")
        if tier not in buckets:
            continue

        # The Hebrew short name is the display name; the full legal name is
        # kept only when the short one is missing, because "בע''מ" adds nothing
        # to a match against a careers page.
        name = (row[I_NAME] or "").strip()
        if not name and len(row) > I_FULLNAME:
            name = (row[I_FULLNAME] or "").strip()
        buckets[tier].append((name or domain, domain))

    total = sum(len(v) for v in buckets.values())
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("# Candidates from the TASE listed-companies register.\n")
        fh.write("# Generated by scripts/seed/tase_companies.py — do not hand-edit.\n")
        fh.write("# Format:  Name | domain\n")
        for tier in wanted:
            entries = buckets.get(tier) or []
            if not entries:
                continue
            fh.write(f"\n# --- {tier} ({len(entries)}) ---\n")
            for name, domain in entries:
                fh.write(f"{name} | {domain}\n")

    print(f"listed rows read     : {len(rows) - DATA_START}", file=sys.stderr)
    print(f"no usable website    : {no_site}", file=sys.stderr)
    print(f"already known        : {skipped_known}", file=sys.stderr)
    for tier in wanted:
        print(f"  {tier:12s}       : {len(buckets.get(tier) or [])}", file=sys.stderr)
    print(f"written to {args.out}: {total}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
