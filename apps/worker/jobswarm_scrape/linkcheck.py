"""Close listings whose source page says the job is gone.

We only learn a job closed when a later crawl stops returning it, and the boards
do not reliably drop dead roles from their feeds. The result a seeker sees is a
click through to "this job is no longer available", which is the worst failure
this product has: it spent someone's attention on something we said was open.

**Neither board returns an error for a dead job.** Both answer HTTP 200,
verified against live URLs on 2026-09-09:

    AllJobs   200, body contains "המשרה נמחקה" (the job was deleted)
    Drushim   200, but /job/<id>/ redirects to the site root

So checking the status code finds neither. This looks at three things: the
status, where the request finally landed, and whether the body carries a
known tombstone phrase.

Deliberately conservative. A network blip, a bot wall or a timeout is NOT
evidence a job is dead, and closing a live listing is worse than leaving a dead
one up for another day: the seeker who would have applied never sees it again.
Anything ambiguous is left open and re-checked on the next run.
"""

from __future__ import annotations

import asyncio
import random
from typing import Any, Iterable
from urllib.parse import urlparse

import httpx

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
}

# Phrases that only appear on a tombstone page. Kept narrow on purpose: a phrase
# that could also appear inside a live listing would close live jobs.
DEAD_PHRASES = (
    "המשרה נמחקה",           # AllJobs: "the job was deleted"
    "המשרה אינה פעילה",      # "the job is not active"
    "המשרה כבר לא רלוונטית",  # "the job is no longer relevant"
    "job is no longer available",
    "this job has expired",
    "position has been filled",
    "no longer accepting applications",
)

# A dead listing on these hosts redirects to the site root instead of erroring.
# Landing on the root with no path is the tell.
REDIRECT_TO_ROOT_HOSTS = ("drushim.co.il", "alljobs.co.il")

# Statuses that mean gone. 403/429 do NOT: they mean we were blocked, which says
# nothing about the job.
DEAD_STATUSES = {404, 410}

# Per-host politeness. Drushim answered 503s under load during the initial
# crawl, so it gets the widest gap.
HOST_DELAY = {
    "drushim.co.il": 3.5,
    "alljobs.co.il": 2.0,
}
DEFAULT_DELAY = 1.2


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def looks_dead(url: str, status: int, final_url: str, body: str) -> bool:
    """Whether the page is positive evidence the listing is gone."""
    if status in DEAD_STATUSES:
        return True

    # Anything other than a clean 200 is inconclusive, not dead.
    if status != 200:
        return False

    host = _host(url)
    if any(host.endswith(h) for h in REDIRECT_TO_ROOT_HOSTS):
        final = urlparse(final_url)
        # Landed on the bare domain, i.e. bounced off a job page onto the home
        # page. Only counts when we started somewhere deeper.
        if final.path in ("", "/") and urlparse(url).path not in ("", "/"):
            return True

    low = body.lower()
    return any(p.lower() in low for p in DEAD_PHRASES)


async def check_one(client: httpx.AsyncClient, job: dict[str, Any]) -> tuple[str, bool | None]:
    """Return (job_id, dead). `None` means inconclusive: leave it open."""
    url = job.get("apply_url") or job.get("source_url")
    if not url:
        return job["id"], None

    try:
        r = await client.get(url, headers=HEADERS, follow_redirects=True, timeout=25)
    except (httpx.HTTPError, asyncio.TimeoutError):
        # A network failure says nothing about the listing.
        return job["id"], None

    # Only read enough to find a tombstone phrase; these pages are large and the
    # marker is always in the visible body near the top.
    body = r.text[:200_000] if r.headers.get("content-type", "").startswith("text") else ""
    return job["id"], looks_dead(url, r.status_code, str(r.url), body)


async def check_jobs(jobs: list[dict[str, Any]], *, concurrency: int = 4) -> tuple[list[str], list[str]]:
    """Check a batch. Returns (dead_ids, alive_ids).

    Grouped by host so the per-host delay actually paces each site rather than
    the batch as a whole: four workers hitting one board at once is what earns a
    block, and the point of this job is to be invisible.
    """
    by_host: dict[str, list[dict[str, Any]]] = {}
    for j in jobs:
        by_host.setdefault(_host(j.get("apply_url") or j.get("source_url") or ""), []).append(j)

    dead: list[str] = []
    alive: list[str] = []

    async with httpx.AsyncClient(http2=False) as client:

        async def run_host(host: str, items: list[dict[str, Any]]) -> None:
            delay = HOST_DELAY.get(host, DEFAULT_DELAY)
            for job in items:
                job_id, is_dead = await check_one(client, job)
                if is_dead is True:
                    dead.append(job_id)
                elif is_dead is False:
                    alive.append(job_id)
                # Jitter so the pattern is not a metronome.
                await asyncio.sleep(delay + random.uniform(0, 0.6))

        sem = asyncio.Semaphore(concurrency)

        async def guarded(host: str, items: list[dict[str, Any]]) -> None:
            async with sem:
                await run_host(host, items)

        await asyncio.gather(*(guarded(h, i) for h, i in by_host.items() if h))

    return dead, alive


def chunked(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]
