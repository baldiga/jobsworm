"""Public Facebook groups - PLAN.md section 4.3.

Two jobs live here: discovering candidate groups, and reading posts out of the
approved ones.

**Hard rules, from the plan and from privacy law.**

* Public groups only. We never log in, never send a cookie, and never touch a
  private group regardless of how large it is.
* Poster identity is never stored. We keep a salted hash and a coarse poster
  type so the ghost meter and the "posted by an employee" badge can work, and
  we throw the name away. The salt lives in the environment, so the hashes are
  not reversible from a database dump alone.
* Excerpts are capped at 300 characters. We link out to the post for the rest.
* Raw posts are retained 30 days.

Observed live: an unauthenticated request is refused outright (HTTP 400/302),
but a residential fetch through rung 4 returns the group's public preview,
which carries a handful of recent posts in `div[role="article"]`. That is a
few posts per group per run, so this source accumulates rather than backfills.

**Use at your own risk.** This reads publicly visible group posts. Whether you
may collect and republish them depends on your jurisdiction, Facebook's terms
and the privacy law that applies to you, and is your responsibility alone. The
code is provided as is, without warranty. See "Data sources and the law" in
the README.
"""

from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from selectolax.parser import HTMLParser

from ..ladder import FetchError, fetch

GROUP_URL = "https://www.facebook.com/groups/{slug}/"

# Seeds for discovery. PLAN.md 4.3 lists these phrasings.
DISCOVERY_QUERIES = [
    "משרות בהייטק site:facebook.com/groups",
    "דרושים הייטק site:facebook.com/groups",
    "דרושים מפתחים site:facebook.com/groups",
    "משרות QA site:facebook.com/groups",
    "דרושים דאטה site:facebook.com/groups",
    "משרות DevOps site:facebook.com/groups",
    "hi-tech jobs israel facebook group",
    "משרות סטארטאפ site:facebook.com/groups",
]

# A post is a plausible job ad if it talks like one. The real classifier runs
# later in `@jobsworm/core`; this only avoids storing obvious chatter.
JOB_CUES = (
    "מגייס", "מגייסים", "דרוש", "דרושה", "דרושים", "מחפשים", "משרה", "משרות",
    "hiring", "we are looking", "we're looking", "open position", "join our team",
    "קו\"ח", "קורות חיים", "job opening", "רלוונטי/ת", "שלחו",
)

RECRUITER_CUES = ("מגייס", "מגייסת", "recruiter", "talent", "hr", "משאבי אנוש")
# Facebook writes the byline either as "לפני 4 שעות" or bare "4 שעות", and
# sprinkles bidi control marks through it.
_BIDI = dict.fromkeys(map(ord, "‎‏‪‫‬⁦⁧⁨⁩ "), " ")
_REL_TIME = re.compile(
    r"(?:לפני\s+)?(\d+)?\s*(דקה|דקות|שעה|שעות|יום|ימים|שבוע|שבועות|חודש|חודשים)"
)
_PUBLIC_MARKER = re.compile(r"משותף עם:\s*קבוצה ציבורית|Shared with:?\s*Public group")


def group_slug(url: str) -> str:
    m = re.search(r"facebook\.com/groups/([^/?#]+)", url)
    return m.group(1) if m else ""


def poster_hash(name: str) -> str:
    """Salted, truncated hash. Never store or log the name itself."""
    salt = os.environ.get("POSTER_HASH_SALT", "")
    if not salt:
        # Refuse to write a bare hash of a personal name: an unsalted digest of
        # a short name is trivially reversible with a wordlist.
        raise RuntimeError(
            "POSTER_HASH_SALT must be set before scraping social sources"
        )
    return hashlib.sha256((salt + "|" + name.strip().lower()).encode("utf-8")).hexdigest()[:32]


def classify_poster(text: str) -> str:
    low = text.lower()
    if any(cue in low for cue in RECRUITER_CUES):
        return "recruiter"
    return "unknown"


def _posted_at(text: str) -> str | None:
    m = _REL_TIME.search(text)
    if not m:
        return None
    n = int(m.group(1) or 1)
    unit = m.group(2)
    if unit.startswith("דק"):
        delta = timedelta(minutes=n)
    elif unit.startswith("שע"):
        delta = timedelta(hours=n)
    elif unit.startswith("יו") or unit.startswith("ימ"):
        delta = timedelta(days=n)
    elif unit.startswith("שב"):
        delta = timedelta(weeks=n)
    else:
        delta = timedelta(days=30 * n)
    return (datetime.now(timezone.utc) - delta).isoformat()


# Groups carry as many "looking for work" posts as "hiring" posts, and a
# seeker post shares most of its vocabulary with an ad. These first-person
# phrasings are the reliable tell.
SEEKER_CUES = (
    "מחפש את התפקיד", "מחפשת את התפקיד", "מחפש עבודה", "מחפשת עבודה",
    "מחפש הזדמנות", "מחפשת הזדמנות", "אשמח להמלצות", "אשמח לעזרה",
    "קורות החיים שלי", "הרזומה שלי", "פנוי/ה לעבודה", "מסיים/ת",
    "looking for my next", "open to work", "seeking a position", "seeking work",
)


def looks_like_seeker(text: str) -> bool:
    return any(cue in text for cue in SEEKER_CUES)


def looks_like_job(text: str) -> bool:
    if len(text) <= 80:
        return False
    if looks_like_seeker(text):
        return False
    return any(cue in text for cue in JOB_CUES)


def parse_group(html: str, slug: str) -> list[dict[str, Any]]:
    """Pull public posts out of a group page.

    The first line of an article is Facebook's own byline ("<name> לפני 2 ימים
    · משותף עם: קבוצה ציבורית"). We use it to derive the timestamp and the
    poster type, then drop it so the name never reaches storage.
    """
    tree = HTMLParser(html)
    posts: list[dict[str, Any]] = []

    for article in tree.css('div[role="article"]'):
        text = " ".join(article.text(separator=" ", strip=True).split())
        if not text:
            continue

        text = text.translate(_BIDI)
        text = " ".join(text.split())
        posted_at = _posted_at(text)

        # Strip the byline "<name> <time> · משותף עם: קבוצה ציבורית". The
        # public-group marker is the most reliable cut point; the timestamp is
        # the fallback. Everything before the cut is the poster's name and must
        # never reach storage.
        cut = None
        pub = _PUBLIC_MARKER.search(text)
        if pub:
            cut = pub.end()
        else:
            m = _REL_TIME.search(text)
            if m and m.start() < 120:
                cut = m.end()

        if cut is None:
            # We cannot prove where the name ends, so we drop the post rather
            # than risk storing it. Privacy fails closed.
            continue

        name = text[:cut]
        body = text[cut:].lstrip(" ·-–—").strip()
        # Trailing Facebook chrome.
        body = re.split(r"\s+(?:עוד\s+)?לייק\s+הוספת|\s+Like\s+Comment\s+Share", body)[0].strip()

        if not looks_like_job(body):
            continue

        # Belt and braces: if any word from the byline survived into the body,
        # the split was wrong and the post is not safe to store.
        byline_words = [w for w in re.sub(r"[\d·:]", " ", name).split() if len(w) > 2]
        if any(w in body[:200] for w in byline_words):
            continue

        link = article.css_first('a[href*="/posts/"], a[href*="permalink"]')
        href = link.attributes.get("href", "") if link else ""
        if href.startswith("/"):
            href = "https://www.facebook.com" + href
        post_url = href.split("?")[0] or GROUP_URL.format(slug=slug)

        posts.append(
            {
                "text": body[:4000],
                "excerpt": body[:300],
                "url": post_url,
                "group_slug": slug,
                "posted_at": posted_at,
                "poster_type": classify_poster(name or body[:120]),
                "poster_hash": poster_hash(name) if name else None,
                "platform": "facebook",
            }
        )

    return posts


async def scrape_group(slug: str) -> tuple[list[dict[str, Any]], int, list[str]]:
    """Read one approved public group. Rung 4 is required in practice."""
    url = GROUP_URL.format(slug=slug)
    notes: list[str] = []
    try:
        # Rung 0 is always refused for facebook.com, but it costs nothing to
        # try and it keeps the ladder honest if that ever changes.
        res = await fetch(url, rungs=(0, 4), timeout=150.0)
    except FetchError as exc:
        return [], 0, [str(exc)[:200]]

    posts = parse_group(res.html, slug)
    if not posts:
        notes.append(f"{slug}: page fetched at rung {res.rung} but no job-like posts")
    return posts, res.rung, notes


def candidates_from_results(results: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Turn search results into `sources` rows, always as `candidate`.

    Nothing is ingested until a human flips a row to `approved`.
    """
    out: dict[str, dict[str, Any]] = {}
    for r in results:
        url = r.get("url", "")
        slug = group_slug(url)
        if not slug:
            continue
        out[slug] = {
            "key": f"facebook:group:{slug}",
            "kind": "facebook_group",
            "label": (r.get("title") or "").strip()[:200],
            "url": GROUP_URL.format(slug=slug),
            "review_state": "candidate",
            "config": {
                "slug": slug,
                # core = hi-tech job board, adjacent = tech-relevant niche,
                # broad = general board that carries some tech. Drives which
                # groups are worth spending a residential fetch on.
                "tier": r.get("tier", "broad"),
                "discovered_via": r.get("query", "search"),
            },
        }
    return list(out.values())


# ---------------------------------------------------------------------------
# Permalink harvesting
#
# A logged-out group page shows two or three posts, no matter which surface you
# ask for: www, m., mbasic and ?sorting_setting=CHRONOLOGICAL all return the
# same payload (verified: 3 role="article" nodes, 2 message.text entries).
# Individual post permalinks, on the other hand, render in full to anyone, and
# carry the whole post body in `og:description`.
#
# So volume comes from finding permalinks, not from re-reading feeds.
# ---------------------------------------------------------------------------

# Queries are role-first on purpose. Searching for "הייטק" matches
# "לחברת הייטק" - a company type, not a job - and fills the results with office
# managers and bookkeepers at tech firms, every one of which the tech gate then
# discards after we have already paid to fetch it.
#
# Budget: the Brave free tier is 2,000 queries a month. 16 queries four times a
# day is 1,920, which fits with room to spare.
POST_QUERIES = [
    'site:facebook.com/groups "דרוש/ה" מפתח full stack',
    'site:facebook.com/groups "דרוש/ה" מפתח backend',
    'site:facebook.com/groups "דרוש/ה" מפתח frontend',
    'site:facebook.com/groups "דרוש/ה" QA אוטומציה',
    'site:facebook.com/groups "דרוש/ה" DevOps',
    'site:facebook.com/groups "דרוש/ה" data engineer דאטה',
    'site:facebook.com/groups "דרוש/ה" אנליסט/ית נתונים',
    'site:facebook.com/groups "דרוש/ה" מנהל/ת מוצר product manager',
    'site:facebook.com/groups "דרוש/ה" סייבר אבטחת מידע',
    'site:facebook.com/groups "דרוש/ה" מהנדס/ת תוכנה embedded',
    'site:facebook.com/groups "דרוש/ה" מעצב/ת UX UI',
    'site:facebook.com/groups "מגייסים" מפתח/ת תוכנה',
    'site:facebook.com/groups "מגייסים" data scientist AI',
    'site:facebook.com/groups "we are hiring" israel software engineer',
    'site:facebook.com/groups "join our team" israel developer',
    'site:facebook.com/groups משרה python java node react',
]

# A permalink costs one residential fetch, so the SERP title is used to reject
# obvious non-tech before spending it. Brave's snippet is Facebook boilerplate
# ("Popular groups - Find communities for you") and carries no signal, so the
# title is all we have to filter on.
TITLE_TECH_CUES = (
    "מפתח", "מתכנת", "תוכנה", "פיתוח", "אוטומציה", "בודק", "אלגוריתמ",
    "דאטה", "נתונים", "אנליסט", "סייבר", "אבטחת מידע", "מערכות מידע",
    "אמבדד", "חומרה", "ארכיטקט", "מוצר", "מהנדס", "טכנולוג", "מחשוב",
    "developer", "engineer", "engineering", "programmer", "software",
    "backend", "frontend", "full stack", "fullstack", "devops", "sre",
    "qa", "automation", "data", "analyst", "scientist", "cyber", "security",
    "product manager", "ux", "ui", "python", "java", "node", "react",
    "kubernetes", "cloud", "ml", "ai", "algorithm", "embedded", "architect",
)

# Roles that sit inside tech companies but are not tech jobs. The real gate
# runs later in @jobsworm/core; this only avoids paying to fetch them.
TITLE_REJECT_CUES = (
    "מנהל/ת משרד", "פקיד", "מזכיר", "אדמיניסטרצי", "לוגיסטיק", "מחסנאי",
    "נציג/ת שירות", "נציגי שירות", "חשבונות", "הנהלת חשבונות", "גבייה",
    "מוקד", "טלמרקטינג", "משאבי אנוש", "רכש", "נהג", "מלצר", "אבטחה פיזית",
    "receptionist", "office manager", "bookkeep", "logistics", "driver",
)


def title_looks_tech(title: str) -> bool:
    low = title.lower()
    if any(cue in low for cue in TITLE_REJECT_CUES):
        return False
    return any(cue in low for cue in TITLE_TECH_CUES)

_PERMALINK = re.compile(r"facebook\.com/groups/([^/?#]+)/(?:posts|permalink)/([^/?#]+)")


def permalink_parts(url: str) -> tuple[str, str] | None:
    m = _PERMALINK.search(url)
    return (m.group(1), m.group(2)) if m else None


def parse_permalink_page(html: str, url: str) -> dict[str, Any] | None:
    """Read one public post page.

    `og:description` is the post body as Facebook itself publishes it for link
    previews, so it needs no byline stripping: it never contains the author's
    name. That makes it both richer and safer than scraping the rendered feed.
    """
    og = re.search(r'<meta property="og:description" content="([^"]*)"', html)
    body = ""
    if og:
        body = og.group(1)
        # og content is HTML-escaped once.
        for a, b in (("&quot;", '"'), ("&#039;", "'"), ("&amp;", "&"),
                     ("&lt;", "<"), ("&gt;", ">"), ("&#x27;", "'")):
            body = body.replace(a, b)
        body = body.translate(_BIDI)
        body = " ".join(body.split())

    if not looks_like_job(body):
        return None

    parts = permalink_parts(url)
    slug = parts[0] if parts else ""

    return {
        "text": body[:4000],
        "excerpt": body[:300],
        "url": url.split("?")[0],
        "group_slug": slug,
        "posted_at": None,
        # og:description carries no byline, so there is no name to classify.
        "poster_type": classify_poster(body[:160]),
        "poster_hash": None,
        "platform": "facebook",
        "via": "permalink",
    }


async def scrape_permalink(url: str) -> tuple[dict[str, Any] | None, int, str | None]:
    try:
        res = await fetch(url, rungs=(0, 4), timeout=150.0)
    except FetchError as exc:
        return None, 0, str(exc)[:160]
    return parse_permalink_page(res.html, url), res.rung, None
