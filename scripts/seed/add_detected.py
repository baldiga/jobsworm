#!/usr/bin/env python3
"""
add_detected.py — fold detect_ats.py output into data/companies.seed.json.

`build_seed.py` and `merge_seed.py` rebuild the whole seed from the original
verification work directories, which is the right tool when re-deriving
everything and the wrong one for adding a handful of boards found by a later
probe. This adds, and only adds.

Rules:

  * A board counts only if the feed returned at least one ISRAELI job. A
    Greenhouse token that serves nothing but San Francisco roles is a company
    we would crawl forever for nothing.
  * `domain` is the key, matching PLAN.md 4.1 and the seeder's own dedupe. A
    domain already in the seed is left alone unless the new probe found more
    Israeli jobs, in which case the better board wins and the sources union.
  * `sources` records where the candidate came from, so a later audit can ask
    what a given discovery run actually bought.

    python scripts/seed/add_detected.py --in probe.json --source tase
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_ats import careers_url, feed_url  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SEED = os.path.join(ROOT, "data", "companies.seed.json")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True, nargs="+",
                    help="one or more detect_ats.py output files")
    ap.add_argument("--source", required=True, help="label for sources[], e.g. tase")
    ap.add_argument("--seed", default=SEED)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(args.seed, encoding="utf-8") as fh:
        seed = json.load(fh)
    by_domain = {(c.get("domain") or "").lower(): c for c in seed if c.get("domain")}
    before = len(by_domain)

    found = []
    for path in args.inp:
        with open(path, encoding="utf-8") as fh:
            found.extend(json.load(fh))

    added, improved, skipped_no_il, skipped_worse = 0, 0, 0, 0
    for f in found:
        israeli = int(f.get("jobs_israel") or 0)
        if israeli < 1:
            skipped_no_il += 1
            continue
        domain = (f.get("domain") or "").lower()
        provider, token = f.get("provider"), f.get("token")
        if not (domain and provider and token):
            skipped_no_il += 1
            continue

        entry = {
            "name": f.get("name") or domain,
            "domain": domain,
            "ats_provider": provider,
            "ats_token": token,
            "ats_feed_url": feed_url(provider, token),
            # Detected off the company's own careers page and then verified by
            # calling the feed, which is the strongest evidence this pipeline
            # produces. Guessed tokens score lower elsewhere.
            "ats_confidence": 0.95,
            "careers_url": f.get("careers_url") or careers_url(provider, token, domain),
            "jobs_total": int(f.get("jobs_total") or 0),
            "jobs_israel": israeli,
            "sources": [args.source],
        }

        prior = by_domain.get(domain)
        if prior is None:
            by_domain[domain] = entry
            added += 1
        elif israeli > int(prior.get("jobs_israel") or 0):
            entry["sources"] = sorted({*(prior.get("sources") or []), args.source})
            by_domain[domain] = entry
            improved += 1
        else:
            prior["sources"] = sorted({*(prior.get("sources") or []), args.source})
            skipped_worse += 1

    out = sorted(by_domain.values(), key=lambda c: c["domain"])
    print(f"seed before        : {before}")
    print(f"probe entries read : {len(found)}")
    print(f"  added            : {added}")
    print(f"  improved existing: {improved}")
    print(f"  no Israeli jobs  : {skipped_no_il}")
    print(f"  already better   : {skipped_worse}")
    print(f"seed after         : {len(out)}")
    print(f"new Israeli jobs   : {sum(c['jobs_israel'] for c in out) - sum(int(c.get('jobs_israel') or 0) for c in seed)}")

    if args.dry_run:
        print("(dry run, nothing written)")
        return 0

    with open(args.seed, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"wrote {args.seed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
