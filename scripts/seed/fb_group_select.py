#!/usr/bin/env python3
"""
fb_group_select.py — decide which enriched candidates are worth crawling, and
write them out ready to load as approved sources.

## What this is actually filtering for

Not quality. The ingest gate already protects the index: a courier job
classifies as non_tech and is dropped, a job in Cairo is dropped as abroad, and
the last sweeps discarded 1,263 non-tech and 1,264 abroad posts between them.
An irrelevant group does not put rubbish on the site.

It costs money. Every post fetched is billed at $1.71 per thousand whether the
gate keeps it or bins it, so a group of Thai penetration testers is pure spend.
This filter is about not paying to scrape posts we are certain to discard.

## The three rules

1. PUBLIC ONLY, and `unknown` is not public. Fail-closed, the same rule
   assert_public() applies at read time.
2. Not somewhere else. "UxUi Thailand", "UI/UX jobs in Egypt" and a Thai-script
   cybersecurity group are all real, active, and none of their jobs can ever
   pass the abroad check.
3. Not a trade we do not index. Couriers, drivers, agriculture, cleaning,
   restaurant work. These are honest job groups and every post in them will be
   dropped as non_tech.

Everything else is kept, INCLUDING the general city boards — "דרושים חיפה
והקריות" and its like. They are the "broad" tier the plan already describes as
"general jobs boards that carry some tech", the existing 185 include many of
them, and the per-group cap mechanism throttles whichever turn out to be quiet.
Guessing which ones carry tech from the name would be a worse filter than
measuring it.

    python scripts/seed/fb_group_select.py --in data/fb_enriched.json \\
        --out data/fb_approved.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys

# Places whose jobs cannot pass the abroad gate. Matched on the group name.
ELSEWHERE = [
    "thailand", "หางาน", "egypt", "مصر", "dubai", "uae", "cyprus", "greece",
    "india", "pakistan", "philippines", "kenya", "nigeria", "ukraine",
    "poland", "romania", "berlin", "london", "new york", "toronto",
    "portugal", "lisbon", "barcelona", "madrid",
]

# Trades the index does not carry. Every post is dropped as non_tech, so
# fetching them is spend with a guaranteed zero return.
NOT_OUR_TRADE = [
    "שליחים", "שליח ", "נהגים", "נהג ", "מלצר", "מלצרים", "חקלאות", "חקלאי",
    "ניקיון", "מנקה", "בייביסיטר", "בייבי סיטר", "מטפלת", "סייעת",
    "אבטחה ושמירה", "מאבטחים", "בנייה ושיפוצים", "שיפוצים", "הובלות",
    "מסעדנות", "מלונאות", "קופאי", "מכירות בדוכן", "חלוקת עיתונים",
    "delivery driver", "babysitter", "cleaner", "waiter", "waitress",
]

# Groups that are communities rather than job boards. Kept out because their
# posting volume is enormous and their hiring share is tiny — the worst
# possible ratio for a per-post bill.
NOT_A_JOB_BOARD = [
    "travelers helping travelers", "let's talk aliyah", "lets talk aliyah",
    "במה חופשית", "הכנסה פסיבית",
    # The two most expensive groups the sweep found, and the two least likely
    # to repay it.
    #
    # "Secret Tel Aviv" has 651,000 members and is a general expatriate
    # community — flat shares, restaurant recommendations, the occasional
    # vacancy. At 20 posts a sweep it would be the biggest single line on the
    # Apify bill for close to nothing. It is also the same organisation whose
    # job BOARD sits in WITHHELD_SOURCES.
    #
    # "Data Science" has 482,000 members and is the global group, not an
    # Israeli one. Its postings are worldwide, so the abroad gate discards
    # essentially all of them — paying to fetch posts we are certain to drop is
    # the exact thing this filter exists to prevent.
    #
    # Both matched a tech or jobs cue, which is why a name-based tier alone is
    # not enough and size has to be read alongside it.
    "secret tel aviv",
]

# Matched on the group slug rather than the name, for the cases where the name
# is too generic to match safely. "Data Science" as a substring would catch
# every Israeli data group there is.
SKIP_SLUGS = {"datasciencegroup"}


def reason_to_skip(name: str, url: str = "") -> str | None:
    slug = (re.search(r"groups/([^/?]+)", url or "") or [None, ""])[1] if url else ""
    if slug and slug.lower() in SKIP_SLUGS:
        return f"skip-slug:{slug}"
    n = (name or "").lower()
    for cue in ELSEWHERE:
        if cue in n:
            return f"elsewhere:{cue}"
    for cue in NOT_OUR_TRADE:
        if cue.lower() in n:
            return f"not-our-trade:{cue.strip()}"
    for cue in NOT_A_JOB_BOARD:
        if cue in n:
            return f"not-a-board:{cue}"
    return None


# A name that says hi-tech earns a bigger per-group cap later.
TECH_CUES = [
    "הייטק", "hitech", "hi tech", "hi-tech", "high tech", "tech", "מתכנת",
    "developer", "devops", "qa", "sqa", "בדיקות תוכנה", "תוכנה", "software",
    "data", "דאטה", "סייבר", "cyber", "security", "אלגוריתמ", "product",
    "מוצר", "ux", "ui", "סטארטאפ", "startup", "engineer", "מהנדס", "הנדס",
    "it ", "ai", "biotech", "ביוטק", "junicorn", "ג'וניור", "ג׳וניור",
]


def tier_of(name: str, members: int | None) -> str:
    n = (name or "").lower()
    if any(c in n for c in TECH_CUES):
        return "core"
    if (members or 0) >= 20_000:
        return "adjacent"
    return "broad"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-members", type=int, default=800,
                    help="below this a group is too quiet to pay for")
    args = ap.parse_args()

    with open(args.inp, encoding="utf-8") as fh:
        rows = json.load(fh)["results"]

    keep, skipped = [], []
    for r in rows:
        name = r.get("name") or ""
        if r.get("privacy") != "public":
            skipped.append((r.get("privacy", "?"), name))
            continue
        why = reason_to_skip(name, r.get("url", ""))
        if why:
            skipped.append((why, name))
            continue
        members = r.get("members")
        tier = tier_of(name, members)
        # The size floor applies to general boards only. A 40,000-member city
        # board that rarely carries tech is a bad buy; a 649-member group called
        # "סטודנטים - אבטחת מידע וסייבר" is a good one, because nearly
        # everything in it is on topic. Size is a proxy for how much tech a
        # general group might hold, and the proxy is not needed when the name
        # already says.
        if tier != "core" and members is not None and members < args.min_members:
            skipped.append((f"tiny:{members}", name))
            continue
        keep.append({
            "title": name,
            "url": r["url"],
            "tier": tier,
            "query": r.get("query", "brave sweep"),
            "members": members,
        })

    keep.sort(key=lambda r: -(r["members"] or 0))
    tiers: dict[str, int] = {}
    for r in keep:
        tiers[r["tier"]] = tiers.get(r["tier"], 0) + 1

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"counts": tiers, "results": keep}, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    print(f"in            : {len(rows)}", file=sys.stderr)
    print(f"KEEP          : {len(keep)}  {tiers}", file=sys.stderr)
    print(f"skipped       : {len(skipped)}", file=sys.stderr)
    buckets: dict[str, int] = {}
    for why, _ in skipped:
        head = why.split(":")[0]
        buckets[head] = buckets.get(head, 0) + 1
    for k, v in sorted(buckets.items(), key=lambda kv: -kv[1]):
        print(f"  {k:16s} {v}", file=sys.stderr)
    print("\nskipped, by name:", file=sys.stderr)
    for why, name in skipped:
        if not why.startswith(("private", "unknown")):
            print(f"  {why:26s} {name[:52]}", file=sys.stderr)
    print(f"\nwrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
