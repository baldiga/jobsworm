#!/usr/bin/env python3
"""Clean three exported Facebook-group lists down to the ones worth scraping.

    python scripts/seed/clean_fb_groups.py --exports DIR            # report
    python scripts/seed/clean_fb_groups.py --exports DIR --write    # write data/fb_groups_batch.json

DIR holds the three CSV exports (qa.csv, hr.csv, design.csv), with the Hebrew
column headers the export tool writes: קישור לקבוצה, שם הקבוצה, סוג, חברים.

The exports are raw search dumps: a QA list, an HR list and a design list. The
design one in particular is mostly interior decorating, and the HR one is
mostly payroll and welfare — neither belongs in a tech index.

Three rules, in order, and every rejection records which one fired.

1. PUBLIC ONLY. PLAN.md 4.3, enforced again in the scraper by assert_public().
   A private group is rejected outright no matter how relevant it looks; we do
   not read groups a person had to be admitted to.

2. NOT OFF-TOPIC. Interior design, kitchens, furniture, teaching, nannies,
   payroll clerks, welfare officers, secretarial work. These are real job
   groups; they are not tech job groups.

3. ISRAELI. A 1.4M-member "INTERIOR DESIGNERS" or a 121k "The Human Resources
   Group" is a global community, and its postings are not Israeli jobs.

Why rule 2 is strict about HR in particular: `facebook` is in
TECH_CONTEXT_SOURCES, which means a business-function role found in a Facebook
group is treated as a business role AT A TECH COMPANY. That premise holds only
while the groups are tech groups. Adding "דרושים חשבי שכר" would grant tech
context to payroll jobs at any employer in the country — the same mistake the
importer already documents for drushimavodot.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# The three exports, by the list each one came from.
EXPORTS = [("qa.csv", "qa"), ("hr.csv", "hr"), ("design.csv", "design")]

PUBLIC = "ציבורית"

# --- rule 2: off-topic -----------------------------------------------------
# Matched against the group name. Ordered most-specific first only for
# readability; all are tried.
OFF_TOPIC = [
    # Interior design and the home. The whole reason the design export is 73
    # rows and only a handful survive.
    (r"עיצוב\s+(?:פנים|הבית|מטבח|חדרי|אירועים)", "interior/home design"),
    # Named as people rather than as a field: "מעצבי פנים", "תשאלו מעצבת".
    (r"מעצב(?:י|ות|ת)?\s*פנים|תשאלו מעצב|מלבישות בתים", "interior/home design"),
    (r"office design|תכנון ועיצוב משרדים|find my design", "office/generic design"),
    (r"בעלי עסקים", "business owners"),
    # "גרפיקאים מומלצים" is a directory of freelancers to hire, so its posts
    # are people touting services — the freelance_ad class, not vacancies.
    (r"מומלצים|מומלצות", "recommendations directory"),
    # Q&A groups. Almost all discussion, which the non-vacancy gate then drops
    # anyway — so the per-post fetches would be spent for nothing.
    (r"^שאל\s|^ask\s|תשאלו", "Q&A group"),
    (r"אדריכל", "architecture"),
    (r"מטבח|רהיט|סלונים|ארונות|שיפוץ|הום סטיילינג|חדרי רחצה|מזנונים", "home goods"),
    (r"interior design|home design|home decor|dream home|living spaces", "home design (en)"),
    (r"ילדודס|חדרי ילדים", "kids rooms"),
    # Teaching, childcare, shift work.
    (r"נאנית|מטפלת|teacher\s*&\s*nanny", "teaching/childcare"),
    # HR back-office rather than tech hiring.
    (r"חשב(?:י|ת)?\s+שכר|הנהלת חשבונות|מנהלי חשבונות", "payroll/bookkeeping"),
    (r"רווחה", "welfare"),
    (r"מזכירות|אדמיניסטרצי", "administrative"),
    (r"דיני עבודה", "labour law"),
    (r"ועדים", "works councils"),
    (r"מכרזים|המגזר החברתי", "public/social sector"),
    (r"עבודה מהבית", "work-from-home board"),
    # Communities about the profession rather than boards for it.
    (r"ממים של", "memes"),
    (r"בדיחות", "jokes"),
    (r"צרות בהייטק", "venting community"),
    # Courses and freelancing-for-clients.
    (r"learn design|go freelance|teachesdesign", "course marketing"),
    (r"שיעורים פרטיים", "private lessons"),
]

# --- rule 3: not Israeli ---------------------------------------------------
GLOBAL_ONLY = [
    (r"^human resource management$", "global HR community"),
    (r"^the human resources group$", "global HR community"),
    (r"^hr community$", "global HR community"),
    (r"^architecture & design$", "global design community"),
    (r"^interior designers$", "global design community"),
    (r"zajednica", "non-Israeli community"),
    # Named countries other than Israel. Search discovery surfaces these
    # constantly — "UI/UX, Web Designer jobs in Egypt" and "UI/UX Designer
    # Indonesia" both match every tech cue we have and are not Israeli jobs.
    (
        r"\b(?:egypt|indonesia|malaysia|msian|india|pakistan|nigeria|kenya|"
        r"philippines|vietnam|bangladesh|usa|u\.s\.a|canada|deutschland|"
        r"españa|polska|romania|ukraine|dubai|uae|qatar|singapore)\b",
        "foreign country named",
    ),
]

# Communities about learning or attending, rather than boards for hiring.
LEARNING = [
    (r"כנסים|הרצאות|conference|meetup", "events community"),
    (r"לימודי|לומדים|ללמוד|הכשרות|training|bootcamp|course", "training community"),
    (r"^סטודנטים\b|students only", "student community"),
]

# --- accept ----------------------------------------------------------------
# core: an Israeli hi-tech job board. adjacent: a specific tech role's board.
CORE = [
    r"הייטק|היי-טק|היי טק|hi-?tech|high tech",
    r"סטארט\s*אפ|startup",
    r"משרות מחברות",
]
ADJACENT = [
    r"\bqa\b|בדיקות תוכנה|בודקי תוכנה|אוטומציה|automation|testing|tester",
    r"quality assurance|בדיקות איכות",
    r"ux|ui|חווית משתמש|חוויית משתמש|product design",
    r"מעצבים גרפיים|עיצוב גרפי|תקשורת חזותית|גרפיקאים|גרפי|אנשי דיגיטל",
    # Two design JOB boards the patterns above walked past: "דרושים בעיצוב:
    # גרפי /דיגיטלי /מוצר" reads as "בעיצוב" not "עיצוב גרפי", and Bezalel
    # graduates name themselves rather than their field.
    r"בצלאלניקים|דרושים בעיצוב",
    r"מפתחים|developer|programmer|r&d",
    r"סייבר|cyber|אבטחת מידע",
    r"devops|סיסטם|system|helpdesk|help desk|\bit\b",
    r"מדעי המחשב|מערכות מידע",
    r"מנהלי פרויקטים|ניהול מוצר|מנתחי מערכות|pmo|מנהלי מוצר",
    r"women in tech|נשים בהייטק",
    r"בוני אתרים|וורדפרס",
]
# A board has to actually be a board. A community with no hiring in the name is
# only accepted when it is unambiguously a role board (CORE/ADJACENT above plus
# one of these).
HIRING = [r"דרוש|משרות|משרה|גיוס|jobs?\b|hiring|עבודה|עבודות|הזדמנויות|תעסוקה|קריירה"]


def matches(patterns, text: str) -> str | None:
    for pat in patterns:
        p, why = pat if isinstance(pat, tuple) else (pat, pat)
        if re.search(p, text, re.I):
            return why
    return None


def slug_of(url: str) -> str:
    m = re.search(r"/groups/([^/?#]+)", url or "")
    return m.group(1) if m else ""


def classify(name: str, kind: str, members: int) -> tuple[str, str, str]:
    """Return (verdict, tier, reason)."""
    if kind.strip() != PUBLIC:
        return "reject", "", "private group (PLAN 4.3: public only)"

    off = matches(OFF_TOPIC, name)
    if off:
        return "reject", "", f"off-topic: {off}"

    glob = matches(GLOBAL_ONLY, name)
    if glob:
        return "reject", "", f"not Israeli: {glob}"

    learn = matches(LEARNING, name)
    if learn:
        return "reject", "", f"not a job board: {learn}"

    if members and members < 500:
        return "reject", "", f"too small ({members} members)"

    core = matches(CORE, name)
    adj = matches(ADJACENT, name)
    hiring = matches(HIRING, name)

    if core and hiring:
        return "accept", "core", "Israeli hi-tech job board"
    if adj and hiring:
        return "accept", "adjacent", "tech role board"
    if core:
        return "accept", "adjacent", "hi-tech community"
    if adj:
        # A tech community with no hiring word in its name — "Women In Tech",
        # "The Largest QA Community In Israel", "מפתחים בישראל - R&D Israel".
        # Jobs are posted in all of them; they are simply not named as boards.
        # Safe to take now in a way it was not before, because the non-vacancy
        # gate drops the discussion posts these carry more of.
        return "accept", "broad", "tech community (jobs posted, not a board)"
    return "reject", "", "no tech or hiring signal in the name"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exports", type=Path, required=True, help="directory holding the CSV exports")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    files = [(args.exports / name, origin) for name, origin in EXPORTS]

    rows: dict[str, dict] = {}
    rejected: list[tuple[str, str, str]] = []

    for path, origin in files:
        if not path.exists():
            print(f"missing: {path}", file=sys.stderr)
            continue
        with path.open(encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh):
                url = (r.get("קישור לקבוצה") or "").strip()
                name = (r.get("שם הקבוצה") or "").strip()
                kind = (r.get("סוג") or "").strip()
                try:
                    members = int((r.get("חברים") or "0").strip() or 0)
                except ValueError:
                    members = 0
                slug = slug_of(url)
                if not slug or not name:
                    continue

                verdict, tier, reason = classify(name, kind, members)
                if verdict == "reject":
                    rejected.append((name, reason, origin))
                    continue
                # A group in two exports keeps the stronger tier.
                prev = rows.get(slug)
                if prev and prev["config"]["tier"] == "core":
                    continue
                rows[slug] = {
                    "key": f"facebook:group:{slug}",
                    "kind": "facebook_group",
                    "label": name[:200],
                    "url": f"https://www.facebook.com/groups/{slug}/",
                    "review_state": "approved",
                    "config": {
                        "slug": slug,
                        "tier": tier,
                        "members": members,
                        "discovered_via": f"postly export ({origin}) 2026-09-10",
                    },
                }

    print(f"accepted: {len(rows)}")
    for slug, r in sorted(rows.items(), key=lambda kv: -kv[1]["config"]["members"]):
        c = r["config"]
        print(f"  [{c['tier']:<8}] {c['members']:>7,}  {r['label'][:66]}")

    print(f"\nrejected: {len(rejected)}")
    by_reason: dict[str, int] = {}
    for _, reason, _ in rejected:
        by_reason[reason] = by_reason.get(reason, 0) + 1
    for reason, n in sorted(by_reason.items(), key=lambda kv: -kv[1]):
        print(f"  {n:>3}  {reason}")

    if args.write:
        out = ROOT / "data" / "fb_groups_batch.json"
        out.write_text(
            json.dumps(list(rows.values()), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\nwrote {out} ({len(rows)} groups)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
