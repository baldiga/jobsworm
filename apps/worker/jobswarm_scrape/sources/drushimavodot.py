"""Drushim-Avodot, via their public partner feed.

`https://www.drushimavodot.co.il/api/jobs` is an documented OpenAPI endpoint
that the site publishes for partners. That makes this the only source here that
is neither a scrape nor a paid actor: they intend it to be consumed, it returns
structured JSON, and it costs nothing.

## What the feed actually contains

Read from a live 500-job sample on 2026-09-09:

    7,941 active jobs
    top categories: customer service, sales, nursing, restaurants, admin,
                    logistics, management, engineering, hi-tech
    hi-tech: about 3% of rows

**This is a general jobs board, not a tech one.** That single fact decides how
it is wired: it is deliberately NOT added to TECH_CONTEXT_SOURCES. For Facebook
groups and AllJobs tech categories, the crawl itself is restricted to tech
hiring, so a marketing role found there is a marketing role at a tech company.
Here it is far more likely to be a marketing role at a restaurant chain. Only
genuinely tech-function roles pass the 4.5 gate from this source, and the other
~95% are dropped, which is the correct outcome rather than a disappointing one.

## Attribution

The feed returns an `attribution` object and asks for the name and link to be
displayed. That is a condition of a partner feed, so it is carried through to
`meta` and surfaced in the UI as the source label. Consuming a feed that asks
for credit without giving it would be the kind of thing that gets access pulled,
deservedly.

## Expiry

Rows carry a real `expires_at`, frequently same-day. That is better information
than the fixed 14-day window this project applies to every other board, so it is
passed through and used verbatim.
"""

from __future__ import annotations

from typing import Any, Iterator

import httpx

from ..ladder import USER_AGENT
from ..store import ScrapedJob

BASE = "https://www.drushimavodot.co.il"
FEED = f"{BASE}/api/jobs"

# The documented maximum. Anything above it is truncated to 500 server-side, so
# asking for more just wastes a round trip.
PAGE_SIZE = 500

HEADERS = {
    "Accept": "application/json",
    # Identify honestly. This is a partner feed, not something being scraped
    # around, and a contactable user agent is the least we owe them.
    "User-Agent": f"{USER_AGENT} partner-feed-consumer",
}


class FeedError(RuntimeError):
    pass


def _clean(value: Any) -> str:
    return str(value or "").strip()


def to_job(row: dict[str, Any], attribution: dict[str, Any] | None = None) -> ScrapedJob | None:
    """Map one feed row. Returns None when there is not enough to show a card."""
    job_id = _clean(row.get("id"))
    title = _clean(row.get("title"))
    if not job_id or not title:
        return None

    # The feed splits the body across four fields. Keep them as labelled
    # sections rather than concatenating: "requirements" and "responsibilities"
    # are exactly what a reader scans for, and flattening them loses that.
    sections: list[str] = []
    for label, key in (
        ("", "description"),
        ("דרישות התפקיד", "requirements"),
        ("תחומי אחריות", "responsibilities"),
        ("תנאים והטבות", "benefits"),
    ):
        text = _clean(row.get(key))
        if not text:
            continue
        if label:
            sections.append(f"<p><strong>{label}</strong></p>")
        sections.append("<p>" + text.replace("\n", "</p><p>") + "</p>")

    body = "".join(sections)
    if not body:
        return None

    lo, hi = row.get("salary_min"), row.get("salary_max")
    salary_raw = None
    if lo and hi:
        salary_raw = f"{lo}-{hi}"
    elif lo:
        salary_raw = str(lo)

    company = _clean(row.get("company"))

    return ScrapedJob(
        external_id=job_id,
        title=title,
        description_html=body,
        location_raw=_clean(row.get("location")),
        # Their URL already carries partner UTM parameters. Kept verbatim: it is
        # how they attribute the traffic back, and rewriting it would be
        # stripping the credit out of the link.
        apply_url=_clean(row.get("url")) or f"{BASE}/jobs/{job_id}",
        source="drushimavodot",
        company_name=company or None,
        posted_at=row.get("published_at") or None,
        employment_type_raw=_clean(row.get("employment_type")) or None,
        salary_raw=salary_raw,
        company_hidden=not company,
        meta={
            "category": _clean(row.get("category")) or None,
            "experience_level": _clean(row.get("experience_level")) or None,
            "remote_work": bool(row.get("remote_work")),
            "tags": row.get("tags") or [],
            # Real expiry from the publisher beats our fixed 14-day guess.
            "expires_at": row.get("expires_at") or None,
            "attribution": attribution or None,
        },
    )


def fetch_page(limit: int = PAGE_SIZE, offset: int = 0, timeout: float = 30.0) -> dict[str, Any]:
    with httpx.Client(timeout=timeout, headers=HEADERS, follow_redirects=True) as client:
        r = client.get(FEED, params={"limit": limit, "offset": offset})
        if r.status_code >= 400:
            raise FeedError(f"drushimavodot feed HTTP {r.status_code}: {r.text[:180]}")
        try:
            return r.json()
        except ValueError as exc:
            raise FeedError(f"drushimavodot feed returned non-JSON: {exc}") from exc


def iter_jobs(max_jobs: int | None = None) -> Iterator[ScrapedJob]:
    """Page the feed and yield mapped postings.

    Paging is by offset rather than by following `next`, even though the docs
    recommend `next`: the same client has to be able to stop early when
    `max_jobs` is reached, and mixing a server-provided cursor with a local
    limit makes the stopping condition harder to reason about, not easier.
    """
    offset = 0
    seen = 0
    attribution: dict[str, Any] | None = None

    while True:
        page = fetch_page(limit=PAGE_SIZE, offset=offset)
        attribution = attribution or page.get("attribution")
        rows = page.get("jobs") or []
        if not rows:
            return

        for row in rows:
            job = to_job(row, attribution)
            if job:
                yield job
                seen += 1
                if max_jobs and seen >= max_jobs:
                    return

        offset += len(rows)
        total = page.get("total")
        if isinstance(total, int) and offset >= total:
            return
        if not page.get("next"):
            return
