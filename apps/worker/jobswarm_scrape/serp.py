"""Search backend for discovery.

Facebook's logged-out group page exposes only two or three posts, but every
individual post permalink renders in full to anyone. So the way to volume is
not reading group feeds, it is finding permalinks - and that needs a search
engine.

Backends, in preference order:

1. **Brave Search API** (`BRAVE_SEARCH_API_KEY`). 2,000 queries a month free,
   20 results a page, no throttling games. This is the one to use.
2. **DuckDuckGo HTML**. Free and needs no key, but it answers 202 after
   roughly one query and caps at ~7 results, so it is a fallback for
   occasional discovery, not for harvesting.

FloppyData's `web-data/search` is deliberately not wired in: it returns an
empty result array for every query on this account, including the example from
its own documentation.
"""

from __future__ import annotations

import asyncio
import os
import time
import re
import urllib.parse
from dataclasses import dataclass

import httpx

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search"
DDG_ENDPOINT = "https://html.duckduckgo.com/html/"


@dataclass
class SerpHit:
    url: str
    title: str
    snippet: str = ""


class SerpUnavailable(RuntimeError):
    """No backend could answer, or the backend throttled us."""


def backend_name() -> str:
    return "brave" if os.environ.get("BRAVE_SEARCH_API_KEY") else "duckduckgo"


# The free Brave tier allows one query per second; going faster earns a 429.
_BRAVE_MIN_INTERVAL = 1.2
_brave_last = 0.0
_brave_lock = asyncio.Lock()


async def _brave(query: str, count: int) -> list[SerpHit]:
    global _brave_last
    key = os.environ["BRAVE_SEARCH_API_KEY"]

    async with httpx.AsyncClient(timeout=30) as client:
        for attempt in range(3):
            async with _brave_lock:
                wait = _BRAVE_MIN_INTERVAL - (time.monotonic() - _brave_last)
                if wait > 0:
                    await asyncio.sleep(wait)
                _brave_last = time.monotonic()

            r = await client.get(
                BRAVE_ENDPOINT,
                # `country` is rejected on the free plan ("Unable to validate
                # request parameter(s)"), so results are steered by the query
                # language instead.
                params={"q": query, "count": min(count, 20), "search_lang": "he"},
                headers={"Accept": "application/json", "X-Subscription-Token": key},
            )
            if r.status_code == 429:
                await asyncio.sleep(2.0 * (attempt + 1))
                continue
            r.raise_for_status()
            data = r.json()
            break
        else:
            raise SerpUnavailable("brave: rate limited after 3 attempts")

    return [
        SerpHit(
            url=item.get("url", ""),
            title=_strip(item.get("title", "")),
            snippet=_strip(item.get("description", "")),
        )
        for item in (data.get("web", {}).get("results") or [])
        if item.get("url")
    ]


def _strip(s: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", "", s or "").split())


async def _duckduckgo(query: str, _count: int) -> list[SerpHit]:
    async with httpx.AsyncClient(timeout=40, follow_redirects=True) as client:
        r = await client.post(
            DDG_ENDPOINT,
            data={"q": query},
            headers={"User-Agent": BROWSER_UA, "Accept-Language": "he-IL,he;q=0.9"},
        )
    # DuckDuckGo answers 202 with an empty body when it decides to throttle.
    if r.status_code == 202 or (r.status_code == 200 and "result__a" not in r.text):
        raise SerpUnavailable("duckduckgo: throttled")
    r.raise_for_status()

    hits: list[SerpHit] = []
    for href, title in re.findall(
        r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', r.text, re.S
    ):
        if "uddg=" in href:
            m = re.search(r"uddg=([^&]+)", href)
            if m:
                href = urllib.parse.unquote(m.group(1))
        hits.append(SerpHit(url=href, title=_strip(title)))
    return hits


async def search(query: str, count: int = 20) -> list[SerpHit]:
    if os.environ.get("BRAVE_SEARCH_API_KEY"):
        return await _brave(query, count)
    return await _duckduckgo(query, count)


async def search_many(
    queries: list[str], count: int = 20, delay: float = 2.0
) -> tuple[list[SerpHit], list[str]]:
    """Run several queries, tolerating a backend that throttles mid-way."""
    seen: dict[str, SerpHit] = {}
    notes: list[str] = []

    for i, q in enumerate(queries):
        try:
            for hit in await search(q, count):
                seen.setdefault(hit.url, hit)
        except SerpUnavailable as exc:
            notes.append(f"{q[:40]}: {exc}")
            # A throttled free backend will not recover within this run.
            if backend_name() == "duckduckgo":
                notes.append("duckduckgo throttled; set BRAVE_SEARCH_API_KEY for real volume")
                break
        except Exception as exc:  # noqa: BLE001
            notes.append(f"{q[:40]}: {type(exc).__name__}: {exc}"[:160])
        if i + 1 < len(queries) and backend_name() == "duckduckgo":
            await asyncio.sleep(delay)

    return list(seen.values()), notes
