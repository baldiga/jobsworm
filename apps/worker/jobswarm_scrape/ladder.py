"""The escalation ladder from PLAN.md section 4.7.

Always start at the cheapest rung that works and record which rung actually
produced the page, so `runs` shows where the money went.

    0  plain HTTPS (httpx)          ATS JSON, XML/RSS, server-rendered HTML
    1  Crawl4AI                     static or lightly dynamic pages
    2  Scrapling StealthyFetcher    anti-bot fingerprinting (Camoufox)
    3  browser-use / Playwright     multi-step flows a static fetch cannot express
    4  FloppyData                   blocked IPs, geo-locked pages

Rungs 1-3 depend on optional packages. When they are not installed the ladder
skips them rather than failing, so a bare `pip install -r requirements.txt`
still gets you rung 0 and rung 4.
"""

from __future__ import annotations

import asyncio
import os
import random
import time
from dataclasses import dataclass, field
from typing import Iterable

import httpx

# One bot identity for every honest request the worker makes, pointing at the
# site doing the fetching. Same rule as packages/adapters/src/http.ts: a fork
# that sets NEXT_PUBLIC_SITE_URL identifies as itself.
SITE_URL = (os.environ.get("NEXT_PUBLIC_SITE_URL") or "").strip().rstrip("/") or "https://www.jobsworm.fun"
USER_AGENT = f"JobswormBot/1.0 (+{SITE_URL})"

# A stealth profile is required from rung 2 upward; rung 0/1 identify honestly.
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

FLOPPY_BASE = "https://api.floppydata.net"

# Per-domain politeness. PLAN.md 4.7: 1 req/2s by default, slower for hosts
# that are sensitive to automated traffic.
DEFAULT_DELAY = 2.0
DOMAIN_DELAY = {
    "www.facebook.com": 5.0,
    "facebook.com": 5.0,
    "m.facebook.com": 5.0,
}

_last_hit: dict[str, float] = {}


class FetchError(RuntimeError):
    """Every rung failed, or the response was unusable."""


@dataclass
class FetchResult:
    url: str
    html: str
    rung: int
    elapsed_ms: int
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return bool(self.html)


def _host(url: str) -> str:
    return url.split("//", 1)[-1].split("/", 1)[0].lower()


async def _throttle(url: str) -> None:
    """Randomised per-domain spacing, so we never hammer one host."""
    host = _host(url)
    delay = DOMAIN_DELAY.get(host, DEFAULT_DELAY)
    last = _last_hit.get(host)
    now = time.monotonic()
    if last is not None:
        wait = delay - (now - last) + random.uniform(0, 0.6)
        if wait > 0:
            await asyncio.sleep(wait)
    _last_hit[host] = time.monotonic()


# Bot-wall signatures. A 200 that is really a challenge page is worse than an
# error, because it silently poisons the parser with zero rows.
BLOCK_MARKERS = (
    "Radware Page",
    "Verifying your browser",
    "Just a moment...",
    "Checking your browser before accessing",
    "cf-browser-verification",
    "Attention Required! | Cloudflare",
    "Access Denied",
    "Request unsuccessful. Incapsula",
    "px-captcha",
)


def looks_blocked(html: str) -> bool:
    if not html or len(html) < 400:
        return True
    head = html[:6000]
    return any(marker in head for marker in BLOCK_MARKERS)


async def _rung0(url: str, timeout: float, headers: dict[str, str]) -> str:
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=timeout, headers=headers
    ) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.text


async def _rung1_crawl4ai(url: str, timeout: float) -> str:
    from crawl4ai import AsyncWebCrawler, CacheMode  # type: ignore

    async with AsyncWebCrawler(verbose=False) as crawler:
        result = await crawler.arun(
            url=url, cache_mode=CacheMode.BYPASS, page_timeout=int(timeout * 1000)
        )
        return getattr(result, "html", "") or getattr(result, "cleaned_html", "") or ""


def _rung2_scrapling(url: str, timeout: float) -> str:
    """Scrapling's StealthyFetcher drives Camoufox, a hardened Firefox build."""
    from scrapling.fetchers import StealthyFetcher  # type: ignore

    page = StealthyFetcher.fetch(
        url,
        headless=True,
        network_idle=True,
        humanize=True,
        timeout=int(timeout * 1000),
    )
    return getattr(page, "html_content", "") or str(page)


async def _rung4_floppydata(
    url: str, timeout: float, country: str = "IL", difficulty: str = "high"
) -> str:
    api_key = os.environ.get("FLOPPYDATA_API_KEY")
    if not api_key:
        raise FetchError("FLOPPYDATA_API_KEY is not set")

    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(
            f"{FLOPPY_BASE}/v2/web-data/fetch",
            headers={"X-Api-Key": api_key, "Content-Type": "application/json"},
            json={
                "url": url,
                "countryCode": country,
                "difficulty": difficulty,
                "cacheMaxAgeDays": 0,
            },
        )
        r.raise_for_status()
        return r.json().get("html", "") or ""


async def floppydata_balance() -> dict:
    """Check the balance before spending, per PLAN.md 4.7."""
    api_key = os.environ.get("FLOPPYDATA_API_KEY")
    if not api_key:
        raise FetchError("FLOPPYDATA_API_KEY is not set")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{FLOPPY_BASE}/v2/account/balances", headers={"X-Api-Key": api_key}
        )
        r.raise_for_status()
        return r.json()


async def fetch(
    url: str,
    *,
    rungs: Iterable[int] = (0, 1, 2, 4),
    timeout: float = 45.0,
    stealth_headers: bool = True,
    country: str = "IL",
) -> FetchResult:
    """Walk the ladder until a rung returns a page that is not a bot wall."""
    notes: list[str] = []
    started = time.monotonic()

    headers = {
        "User-Agent": BROWSER_UA if stealth_headers else USER_AGENT,
        "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    for rung in rungs:
        await _throttle(url)
        try:
            if rung == 0:
                html = await _rung0(url, timeout, headers)
            elif rung == 1:
                html = await _rung1_crawl4ai(url, timeout)
            elif rung == 2:
                html = await asyncio.to_thread(_rung2_scrapling, url, timeout)
            elif rung == 4:
                html = await _rung4_floppydata(url, timeout, country=country)
            else:
                notes.append(f"rung {rung}: not implemented, skipped")
                continue
        except ImportError as exc:
            notes.append(f"rung {rung}: not installed ({exc.name})")
            continue
        except Exception as exc:  # noqa: BLE001 - any failure just escalates
            notes.append(f"rung {rung}: {type(exc).__name__}: {exc}".replace("\n", " ")[:200])
            continue

        if looks_blocked(html):
            notes.append(f"rung {rung}: blocked or empty ({len(html)}B)")
            continue

        return FetchResult(
            url=url,
            html=html,
            rung=rung,
            elapsed_ms=int((time.monotonic() - started) * 1000),
            notes=notes,
        )

    raise FetchError(f"all rungs failed for {url}: " + " | ".join(notes))


async def fetch_bytes(url: str, *, timeout: float = 90.0) -> bytes:
    """Fetch a binary body.

    `fetch()` decodes to text, which destroys gzip and other binary payloads:
    re-encoding the decoded string does not reproduce the original bytes.
    Sitemaps are served as .xml.gz, so they need this instead.
    """
    await _throttle(url)
    headers = {
        "User-Agent": BROWSER_UA,
        "Accept": "application/xml,text/xml,application/gzip,*/*",
        "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
    }
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout, headers=headers) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.content
