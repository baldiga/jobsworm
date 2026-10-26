"""Facebook groups via an Apify actor.

Why this exists: the anonymous path tops out at two or three posts per group,
and reading logged in would put a real Facebook account at risk and breach
Facebook's terms, so there is no logged-in reader. An Apify actor reads public
groups on its own infrastructure, for a per-result fee.

**Use at your own risk.** As with sources/facebook.py: whether you may collect
and republish these posts depends on your jurisdiction, Facebook's terms, the
actor's own terms and the privacy law that applies to you, and is your
responsibility alone. The code is provided as is, without warranty. Apify's
own documentation makes the same point about every scraper on its platform.

**Actor-agnostic on purpose.** `APIFY_ACTOR` selects which one runs, because
the two credible options differ in ways that may change:

* `memo23/facebook-public-group-posts-scraper` - both date bounds, and a clear
  run log that says exactly why a post was dropped. Single maintainer.
* `apify/facebook-groups-scraper` - maintained by Apify itself, ~40,000 users
  and 5.6M runs a month. The reliable one.

**MEASURED cost, not the listed price.** Billing across the 2026-09 runs:

    memo23     79 items   $0.133   $1.69 / 1,000   (10-group pilot)
    memo23    488 items   $0.807   $1.65 / 1,000   (60-group sweep)
    apify   3,469 items  $18.89    $5.00-7.00 / 1,000

The listed prices ($1.50 and $2.60 per 1,000) are NOT what gets billed. The
official actor charged three to four times the cheaper one, and a single run
that pulled 2,699 posts cost $13.50 on its own, 71% of a $19 monthly plan in
106 seconds. Anything that changes the default actor or raises `maxItems` is a
budget decision, so treat it as one.

Volume, measured rather than guessed: 2,699 posts over a 60-day window across
66 groups is 0.68 new posts per group per day. The busier lists run nearer 4,
and about a quarter of groups hit the 20-post cap, which is what that cap is
for. At 200 groups on a two-day cadence expect roughly $13-20 a month.

Yield matters as much as unit price: every post is billed, including the ones
our tech and Israel gates then reject.

Both are no-cookie and public-groups-only, which is what PLAN.md 4.3 requires
anyway. Input keys differ slightly between them, so `build_input()` adapts.

Verified against the live actor: its `search` is an AND over whitespace-split
words, not a boolean query, and rejected posts are still billed at the
additional-data rate. So keyword filtering neither works the way the docs imply
nor saves money, and we take the whole recent window and apply our own tech
gate instead.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx

APIFY_BASE = "https://api.apify.com/v2"

# How often to ask whether a started run has finished.
POLL_SECONDS = 10

# --------------------------------------------------------------------------
# Cost control
# --------------------------------------------------------------------------
# Measured from real billing on 2026-09-08, NOT the listed prices:
#
#     memo23/facebook-public-group-posts-scraper   ~$1.74 / 1,000 posts
#     apify/facebook-groups-scraper                 $5-7  / 1,000 posts
#
# The expensive one is 3-4x memo23, and an automatic failover onto it consumed
# an entire $19 plan in a single afternoon.
#
# So it is NEVER selected automatically any more. If memo23 is down, this
# module raises and says what the paid option would cost; a human decides.
# A run moves to the dearer actor only when a person explicitly opts in.
CHEAP_ACTOR = "memo23/facebook-public-group-posts-scraper"
PAID_FALLBACK_ACTOR = "apify/facebook-groups-scraper"
DEFAULT_ACTOR = CHEAP_ACTOR

# Measured post rate across the 66 groups already registered: 2,699 posts over
# a 60-day window = 0.68 new posts per group per day. On a two-day cadence a
# group produces ~1.4 posts, so a cap of 20 is a safety valve for an unusually
# busy group rather than a limit that normally binds.
DEFAULT_MAX_POSTS = 20

# Two days, matching the intended cadence. This is the single most expensive
# setting in the file: bounding the window stops us re-downloading - and
# re-paying for - the same backlog on every sweep. Unbounded, the same 200
# groups cost roughly 15x more per month.
DEFAULT_NEWER_THAN_HOURS = 48

# These groups are Israeli; egressing from Israel gets fewer challenges.
DEFAULT_PROXY_COUNTRY = "IL"

# Groups per actor run.
#
# Measured: 60 groups finish inside 900s, 86 do not. A run that overruns is
# aborted rather than left billing unattended, so an oversized list costs money
# and returns nothing collectable unless someone goes and fetches the dataset by
# hand. Splitting is the fix -- the scheduled sweep passes 200 groups and would
# otherwise abort every time.
DEFAULT_BATCH_SIZE = 50

# The actor's `search` is an AND over whitespace-separated words, not a boolean
# query: passing "דרוש OR מגייסים" made it demand all nine tokens including the
# literal word "or", and it returned nothing across 33 posts. A single term is
# the only safe form.
#
# Left as None by default. Server-side filtering does not actually avoid the
# charge - the log shows scanned-but-rejected posts still billed at the
# additional-data rate - and our own tech gate is stricter than any keyword.
# So we take the whole recent window and filter it ourselves.
JOB_SEARCH_TERMS: str | None = None

# If a keyword pass is ever wanted, use one term. "דרוש" is a substring of
# "דרושים" and "דרוש/ה", so it covers most Hebrew job ads on its own.
SINGLE_TERM_HEBREW = "דרוש"


class ApifyError(RuntimeError):
    pass


def token() -> str:
    t = (os.environ.get("APIFY_TOKEN") or "").strip()
    if not t:
        raise ApifyError("APIFY_TOKEN is not set. Add it to .env.local.")
    return t


def actor_id() -> str:
    return (os.environ.get("APIFY_ACTOR") or DEFAULT_ACTOR).strip()


def paid_fallback_allowed() -> bool:
    """Whether this run may fall back to the 3-4x dearer actor.

    Off unless someone deliberately turns it on for a run. There is no
    automatic path to the expensive actor by design.
    """
    return (os.environ.get("APIFY_ALLOW_PAID_FALLBACK") or "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def estimate_usd(group_count: int, *, actor: str, posts_per_group: float = 1.4) -> float:
    """Rough cost of one sweep, from measured per-post rates.

    `posts_per_group` defaults to the measured two-day rate. Useful for a
    sanity check in the log before a run rather than after the invoice.
    """
    rate = 5.00 if actor.startswith("apify/") else 1.74
    return group_count * posts_per_group * rate / 1000.0


def build_input(
    group_urls: list[str],
    *,
    max_posts: int = DEFAULT_MAX_POSTS,
    newer_than_hours: int = DEFAULT_NEWER_THAN_HOURS,
    search: str | None = JOB_SEARCH_TERMS,
    actor: str | None = None,
    proxy_country: str | None = DEFAULT_PROXY_COUNTRY,
) -> dict[str, Any]:
    """Both actors take group URLs and a recency bound, under different keys."""
    actor = actor or actor_id()

    if actor.startswith("apify/"):
        payload: dict[str, Any] = {
            "startUrls": [{"url": u} for u in group_urls],
            "resultsLimit": max_posts,
            "viewOption": "CHRONOLOGICAL",
        }
        # This actor only takes the human-readable form, not an hour count.
        if newer_than_hours:
            days = max(1, round(newer_than_hours / 24))
            payload["onlyPostsNewerThan"] = f"{days} days"
        return payload

    # memo23 exposes an explicit hour bound, which is what we want: "2 days"
    # rounds to a day boundary and re-fetches up to 24h of already-paid-for
    # posts on every sweep.
    payload = {
        "startUrls": [{"url": u} for u in group_urls],
        "maxItems": max_posts,
        "viewOption": "CHRONOLOGICAL",
        "includeComments": False,
    }
    if newer_than_hours:
        payload["onlyPostsNewerThanHours"] = int(newer_than_hours)
    if proxy_country:
        payload["proxyCountry"] = proxy_country
    if search:
        payload["search"] = search
    return payload


async def _run_one(
    actor: str,
    group_urls: list[str],
    *,
    max_posts: int,
    newer_than_hours: int,
    search: str | None,
    timeout_s: int,
) -> list[dict[str, Any]]:
    payload = build_input(
        group_urls,
        max_posts=max_posts,
        newer_than_hours=newer_than_hours,
        search=search,
        actor=actor,
    )
    act = actor.replace("/", "~")
    headers = {"Authorization": f"Bearer {token()}"}

    async with httpx.AsyncClient(timeout=120) as client:
        # Start the run and poll, rather than run-sync-get-dataset-items.
        #
        # That endpoint has a hard 300-second ceiling that ignores the timeout
        # parameter, and when it trips it returns 408 while the actor KEEPS
        # RUNNING server-side. A 60-group sweep hit it and we were billed
        # $0.44 for results we then threw away. Polling has no such ceiling and,
        # more importantly, we always end up holding the run id, so work that
        # has been paid for can still be collected.
        start = await client.post(f"{APIFY_BASE}/acts/{act}/runs", headers=headers, json=payload)
        if start.status_code == 402:
            raise ApifyError("Apify credit exhausted")
        if start.status_code >= 400:
            raise ApifyError(f"{actor}: HTTP {start.status_code} {start.text[:180]}")

        run = start.json()["data"]
        run_id, dataset_id = run["id"], run["defaultDatasetId"]
        print(f"[apify] run {run_id} started, dataset {dataset_id}")

        deadline = asyncio.get_event_loop().time() + timeout_s
        status = run.get("status", "RUNNING")
        while status in {"READY", "RUNNING"}:
            if asyncio.get_event_loop().time() > deadline:
                # Abort rather than leave it billing unattended.
                await client.post(f"{APIFY_BASE}/actor-runs/{run_id}/abort", headers=headers)
                raise ApifyError(
                    f"{actor}: run {run_id} exceeded {timeout_s}s and was aborted. "
                    f"Anything it did produce is in dataset {dataset_id}."
                )
            await asyncio.sleep(POLL_SECONDS)
            poll = await client.get(f"{APIFY_BASE}/actor-runs/{run_id}", headers=headers)
            status = poll.json().get("data", {}).get("status", status)

        if status != "SUCCEEDED":
            raise ApifyError(
                f"{actor}: run {run_id} ended {status}. Partial results, if any, "
                f"are in dataset {dataset_id}."
            )

        return await fetch_dataset(dataset_id)


async def run_polled(
    actor: str,
    payload: dict[str, Any],
    *,
    timeout_s: int = 900,
) -> list[dict[str, Any]]:
    """Start an actor, poll it, return its dataset.

    Shared with the LinkedIn source. `run-sync-get-dataset-items` has a hard
    300-second ceiling that ignores the timeout parameter, and when it trips it
    returns 408 while the actor KEEPS RUNNING and billing. Polling has no
    ceiling and always leaves us holding the run id, so work that has been paid
    for can still be collected.
    """
    act = actor.replace("/", "~")
    headers = {"Authorization": f"Bearer {token()}"}

    async with httpx.AsyncClient(timeout=120) as client:
        start = await client.post(f"{APIFY_BASE}/acts/{act}/runs", headers=headers, json=payload)
        if start.status_code == 402:
            raise ApifyError("Apify credit exhausted")
        if start.status_code >= 400:
            raise ApifyError(f"{actor}: HTTP {start.status_code} {start.text[:200]}")

        run = start.json()["data"]
        run_id, dataset_id = run["id"], run["defaultDatasetId"]
        print(f"[apify] {actor} run {run_id}, dataset {dataset_id}")

        deadline = asyncio.get_event_loop().time() + timeout_s
        status = run.get("status", "RUNNING")
        while status in {"READY", "RUNNING"}:
            if asyncio.get_event_loop().time() > deadline:
                await client.post(f"{APIFY_BASE}/actor-runs/{run_id}/abort", headers=headers)
                raise ApifyError(
                    f"{actor}: run {run_id} exceeded {timeout_s}s and was aborted. "
                    f"Partial results are in dataset {dataset_id}."
                )
            await asyncio.sleep(POLL_SECONDS)
            poll = await client.get(f"{APIFY_BASE}/actor-runs/{run_id}", headers=headers)
            status = poll.json().get("data", {}).get("status", status)

        if status != "SUCCEEDED":
            raise ApifyError(
                f"{actor}: run {run_id} ended {status}. Partial results, if any, "
                f"are in dataset {dataset_id}."
            )

    return await fetch_dataset(dataset_id)


async def fetch_dataset(dataset_id: str, *, limit: int = 10000) -> list[dict[str, Any]]:
    """Read a run's dataset. Separate so a paid-for run can be collected later."""
    async with httpx.AsyncClient(timeout=180) as client:
        r = await client.get(
            f"{APIFY_BASE}/datasets/{dataset_id}/items",
            headers={"Authorization": f"Bearer {token()}"},
            params={"clean": "true", "limit": limit},
        )
        if r.status_code >= 400:
            raise ApifyError(f"dataset {dataset_id}: HTTP {r.status_code} {r.text[:180]}")
        items = r.json()
    return items if isinstance(items, list) else []


async def run_actor(
    group_urls: list[str],
    *,
    max_posts: int = DEFAULT_MAX_POSTS,
    newer_than_hours: int = DEFAULT_NEWER_THAN_HOURS,
    search: str | None = JOB_SEARCH_TERMS,
    timeout_s: int = 900,
) -> tuple[list[dict[str, Any]], str]:
    """Run the configured actor and return its dataset items.

    There is deliberately no automatic failover onto the expensive actor. It
    bills 3-4x, and silently switching to it is what turned a routine sweep
    into a $13.50 run and emptied the month's credit. If the cheap actor is
    down, this raises and states what the alternative would cost; running it
    is then a decision someone takes on purpose, by setting
    APIFY_ALLOW_PAID_FALLBACK=1 for that run.
    """
    if not group_urls:
        return [], actor_id()

    primary = actor_id()

    # Split before starting anything. See DEFAULT_BATCH_SIZE.
    if len(group_urls) > DEFAULT_BATCH_SIZE:
        merged: list[dict[str, Any]] = []
        used = primary
        batches = [
            group_urls[i : i + DEFAULT_BATCH_SIZE]
            for i in range(0, len(group_urls), DEFAULT_BATCH_SIZE)
        ]
        print(f"[apify] {len(group_urls)} groups -> {len(batches)} runs of <= {DEFAULT_BATCH_SIZE}")
        for n, chunk in enumerate(batches, 1):
            print(f"[apify] batch {n}/{len(batches)}")
            items, used = await run_actor(
                chunk,
                max_posts=max_posts,
                newer_than_hours=newer_than_hours,
                search=search,
                timeout_s=timeout_s,
            )
            merged.extend(items)
        return merged, used

    est = estimate_usd(len(group_urls), actor=primary)
    print(
        f"[apify] {primary} over {len(group_urls)} groups, "
        f"<= {max_posts}/group, last {newer_than_hours}h, est ~${est:.2f}"
    )

    try:
        items = await _run_one(
            primary,
            group_urls,
            max_posts=max_posts,
            newer_than_hours=newer_than_hours,
            search=search,
            timeout_s=timeout_s,
        )
        return items, primary
    except ApifyError as exc:
        if "credit exhausted" in str(exc):
            raise
        first_error = str(exc)[:200]

    # The cheap actor failed. Only proceed if someone opted in for this run.
    if primary == CHEAP_ACTOR and paid_fallback_allowed():
        paid_est = estimate_usd(len(group_urls), actor=PAID_FALLBACK_ACTOR)
        print(
            f"[apify] {CHEAP_ACTOR} failed ({first_error}). "
            f"APIFY_ALLOW_PAID_FALLBACK is set, so falling back to "
            f"{PAID_FALLBACK_ACTOR} at an estimated ~${paid_est:.2f}."
        )
        items = await _run_one(
            PAID_FALLBACK_ACTOR,
            group_urls,
            max_posts=max_posts,
            newer_than_hours=newer_than_hours,
            search=search,
            timeout_s=timeout_s,
        )
        return items, PAID_FALLBACK_ACTOR

    paid_est = estimate_usd(len(group_urls), actor=PAID_FALLBACK_ACTOR)
    raise ApifyError(
        f"{primary} failed: {first_error}\n"
        f"Not falling back automatically: {PAID_FALLBACK_ACTOR} bills 3-4x and "
        f"would cost about ${paid_est:.2f} for this sweep. "
        f"To use it for one run, set APIFY_ALLOW_PAID_FALLBACK=1."
    )


def to_post(item: dict[str, Any]) -> dict[str, Any] | None:
    """Map an actor row onto the same shape the anonymous path produces.

    Poster identity is dropped here exactly as everywhere else: the actor
    returns `user.name`, and we keep neither it nor a hash of it. The actor
    already separates author from body, so unlike the scraped feed there is no
    byline to mis-split - the name simply never enters our pipeline.
    """
    text = (item.get("text") or item.get("message") or "").strip()
    if len(text) < 80:
        return None

    url = item.get("url") or item.get("postUrl") or item.get("topLevelUrl") or ""
    group = item.get("groupTitle") or item.get("groupName") or ""
    slug = ""
    if isinstance(url, str) and "/groups/" in url:
        slug = url.split("/groups/", 1)[1].split("/")[0]

    return {
        "text": text[:4000],
        "excerpt": text[:300],
        "url": str(url).split("?")[0],
        "group_slug": slug,
        "posted_at": item.get("time") or item.get("timestamp") or item.get("date"),
        "poster_type": "unknown",
        "poster_hash": None,
        "platform": "facebook",
        "via": "apify",
        "group_title": group,
    }


async def account_usage() -> dict[str, Any]:
    """Remaining credit, so a run can be skipped before it fails at 402."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{APIFY_BASE}/users/me", params={"token": token()})
        r.raise_for_status()
        data = r.json().get("data", {})
    plan = data.get("plan") or {}
    return {
        "plan": plan.get("id"),
        "monthlyUsageUsd": data.get("currentBillingPeriodUsage", {}).get("totalUsd"),
        "maxMonthlyUsageUsd": plan.get("maxMonthlyUsageUsd"),
    }
