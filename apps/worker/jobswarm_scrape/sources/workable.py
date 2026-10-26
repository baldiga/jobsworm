"""Workable's own aggregated public job board.

Every other ATS in this project is read one employer at a time: we store a
company's board token and call that company's feed. Workable is the exception,
because Workable itself runs a public board across all of its customers —

    https://jobs.workable.com/api/v1/jobs?query=&location=Israel&limit=20

— which is strictly better for us here than per-company tokens. It needs no
token, it covers every Workable customer hiring in Israel at once, and an
employer who starts using Workable tomorrow appears without anyone adding a row.

## Why this source is allowed, when the big Israeli boards are not

AllJobs, Drushim and Jobmaster all forbid republishing their listings, in
almost identical words, which is why the first two are withheld. This board is
the opposite case, twice over:

  1. It exists in order to distribute its customers' jobs. That is its whole
     purpose; every listing links back to the employer's own Workable
     application page, which is where we send the reader.
  2. `jobs.workable.com/robots.txt` carries an express machine-readable grant:

         User-agent: *
         Content-Signal: search=yes, ai-input=yes, ai-train=no

     Under Cloudflare's content-signals vocabulary `search=yes` means
     "building a search index and providing search results (e.g. returning
     hyperlinks and short excerpts)". That is precisely, and only, what
     Jobsworm does with these rows. We do not train on them.

The same robots file disallows `/search*?*` and `/profile*`. Neither is touched
here: this reads `/api/v1/jobs`, and never a candidate profile.

## The API returns 20 rows and has no offset

Verified live on 2026-09-10: `limit` above 20 is a 400, and `nextPageToken`,
`offset`, `page`, `start`, `from` and `skip` every one of them return page one
again. The advertised `totalSize` for Israel was 131 while a single call could
only ever show 20 of them.

So the query space is partitioned instead of paged — the same trick the
Facebook pipeline uses, where searching for permalinks beats reading a feed.
Ask many narrow questions and union the answers by id. Cities alone reached 63
of the 131; the role keywords below are there to surface what a city query
ranks off the bottom, and they are spread across engineering AND the commercial
side on purpose, because the index is thin there.

`location` is a ranking hint rather than a hard filter — a query for Haifa
returns Tel Aviv rows too, and a query for "Airport City" returned 381 results
with not one of them in Israel — so every row is checked against
`location.countryName == "Israel"` before it is kept. Without that check this
source would quietly import American jobs.
"""

from __future__ import annotations

import time
from typing import Any, Iterator

import httpx

from ..ladder import USER_AGENT
from ..store import ScrapedJob

API = "https://jobs.workable.com/api/v1/jobs"

# Identify honestly, as rung 0 of the ladder does. This endpoint serves JSON to
# anyone who asks; there is nothing here to work around.
HEADERS = {
    "Accept": "application/json",
    "User-Agent": USER_AGENT,
}

# The hard ceiling the API enforces. Asking for more is a 400, not a truncation.
PAGE = 20

# Israeli tech geography, ordered roughly by how much hiring happens there, so
# that a run cut short by --max-jobs still gets the densest queries in.
CITIES = [
    "Israel",
    "Tel Aviv",
    "Herzliya",
    "Ramat Gan",
    "Petah Tikva",
    "Netanya",
    "Raanana",
    "Haifa",
    "Jerusalem",
    "Rishon LeZion",
    "Rehovot",
    "Beer Sheva",
    "Kfar Saba",
    "Hod Hasharon",
    "Yokneam",
    "Caesarea",
    "Modiin",
    "Or Yehuda",
    "Rosh Haayin",
    "Nes Ziona",
    "Holon",
    "Bnei Brak",
    "Givatayim",
    "Ashdod",
]

# Role keywords, to reach rows a city query ranks below the twentieth result.
# Half of these are non-engineering deliberately: the index is strong on
# backend and thin on marketing, sales, finance, HR and design.
KEYWORDS = [
    "engineer",
    "developer",
    "software",
    "frontend",
    "backend",
    "full stack",
    "devops",
    "data",
    "qa",
    "security",
    "product manager",
    "designer",
    "ux",
    "marketing",
    "sales",
    "business development",
    "customer success",
    "finance",
    "accountant",
    "human resources",
    "recruiter",
    "operations",
    "project manager",
    "support",
]


class BoardError(RuntimeError):
    pass


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _location_of(job: dict[str, Any]) -> str:
    loc = job.get("location") or {}
    parts = [
        _clean(loc.get("city")),
        _clean(loc.get("subregion")),
        _clean(loc.get("countryName")),
    ]
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        key = part.lower()
        if part and key not in seen:
            seen.add(key)
            out.append(part)
    return ", ".join(out)


def _is_israeli(job: dict[str, Any]) -> bool:
    """The location parameter ranks rather than filters, so check the row."""
    return _clean((job.get("location") or {}).get("countryName")).lower() == "israel"


def _body_of(job: dict[str, Any]) -> str:
    """Description, requirements and benefits arrive as three HTML fields."""
    parts: list[str] = []
    description = _clean(job.get("description"))
    requirements = _clean(job.get("requirementsSection"))
    benefits = _clean(job.get("benefitsSection"))
    if description:
        parts.append(description)
    if requirements:
        parts.append("<h3>Requirements</h3>\n" + requirements)
    if benefits:
        parts.append("<h3>Benefits</h3>\n" + benefits)
    return "\n".join(parts)


def to_job(row: dict[str, Any]) -> ScrapedJob | None:
    """Map one board row, or return None when it should not be published."""
    external_id = _clean(row.get("id"))
    title = _clean(row.get("title"))
    url = _clean(row.get("url"))
    if not external_id or not title or not url:
        return None

    body = _body_of(row)
    if not body:
        return None

    company = row.get("company") or {}
    company_name = _clean(company.get("title"))
    # `workplace` is the feed's own word for the arrangement ("on_site",
    # "hybrid", "remote"). Passed through as a hint rather than decided here;
    # decomposition owns that column.
    workplace = _clean(row.get("workplace")).lower()

    return ScrapedJob(
        external_id=external_id,
        title=title,
        description_html=body,
        location_raw=_location_of(row),
        apply_url=url,
        source="workable",
        company_name=company_name or None,
        posted_at=_clean(row.get("created")) or None,
        employment_type_raw=_clean(row.get("employmentType")) or None,
        company_hidden=not company_name,
        meta={
            "workplace": workplace or None,
            "remote": workplace == "remote",
            "department": _clean(row.get("department")) or None,
            # The employer's own site, which is what makes this source useful
            # twice over: these companies are candidates for the ATS seed list.
            "company_domain": _clean(company.get("website")) or None,
            "language": _clean(row.get("language")) or None,
        },
    )


def _query(client: httpx.Client, *, location: str = "", query: str = "") -> list[dict[str, Any]]:
    params = {"query": query, "location": location, "limit": str(PAGE)}
    response = client.get(API, params=params)
    if response.status_code >= 400:
        raise BoardError(
            f"workable board HTTP {response.status_code}: {response.text[:180]}"
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise BoardError(f"workable board returned non-JSON: {exc}") from exc
    return payload.get("jobs") or []


def probes() -> list[tuple[str, str]]:
    """The (location, keyword) partitions, cities first — the denser questions."""
    return [(city, "") for city in CITIES] + [("Israel", word) for word in KEYWORDS]


def iter_jobs(
    max_jobs: int | None = None,
    *,
    delay: float = 0.4,
    timeout: float = 30.0,
) -> Iterator[ScrapedJob]:
    """Union every partition, deduplicated by the board's own job id.

    Yields at most once per id no matter how many partitions returned it, so
    the caller sees each Israeli posting exactly once.
    """
    seen: set[str] = set()
    yielded = 0

    with httpx.Client(timeout=timeout, headers=HEADERS, follow_redirects=True) as client:
        for location, keyword in probes():
            try:
                rows = _query(client, location=location, query=keyword)
            except BoardError:
                # One bad partition must not cost us the other forty-seven.
                continue

            for row in rows:
                job_id = _clean(row.get("id"))
                if not job_id or job_id in seen:
                    continue
                seen.add(job_id)
                if not _is_israeli(row):
                    continue
                job = to_job(row)
                if not job:
                    continue
                yield job
                yielded += 1
                if max_jobs and yielded >= max_jobs:
                    return

            time.sleep(delay)
