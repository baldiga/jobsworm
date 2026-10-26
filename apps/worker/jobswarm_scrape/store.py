"""Supabase handoff.

The worker never writes to `jobs` directly. It writes parsed postings into
`raw_pages` (or `raw_posts` for social), and `pnpm import:scraped` decomposes
them with `@jobsworm/core` and upserts. One implementation of the rules, the
dictionaries and the tech-only gate, shared by every source.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from supabase import Client, create_client


@dataclass
class ScrapedJob:
    """A posting as scraped, before decomposition."""

    external_id: str
    title: str
    description_html: str
    location_raw: str
    apply_url: str
    source: str
    company_name: str | None = None
    posted_at: str | None = None
    employment_type_raw: str | None = None
    salary_raw: str | None = None
    is_agency_hint: bool = False
    company_hidden: bool = False
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def content_hash(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update((p or "").encode("utf-8", "replace"))
        h.update(b"\x1f")
    return h.hexdigest()


def client() -> Client:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY"
        )
    return create_client(url, key)


def save_page(
    db: Client,
    *,
    url: str,
    source: str,
    jobs: Iterable[ScrapedJob],
    rung: int,
    extra: dict[str, Any] | None = None,
) -> int:
    """Store one scraped listing page and the postings parsed out of it.

    `hash` is unique, so re-running a scrape refreshes the row rather than
    duplicating it. Retention is 14 days (PLAN.md section 3).
    """
    rows = [j.to_dict() for j in jobs]
    if not rows:
        return 0

    payload = {
        "hash": content_hash(source, url, str(len(rows)), rows[0]["external_id"]),
        "url": url,
        "source": source,
        # `content` stays small: the postings live in meta as structured JSON.
        "content": None,
        "meta": {"jobs": rows, "count": len(rows), **(extra or {})},
        "rung": rung,
        "fetched_at": utcnow(),
    }
    db.table("raw_pages").upsert(payload, on_conflict="hash").execute()
    return len(rows)


def save_posts(
    db: Client,
    *,
    source: str,
    posts: list[dict[str, Any]],
    rung: int,
) -> int:
    """Store raw social posts. Retention is 30 days (PLAN.md section 3)."""
    if not posts:
        return 0
    rows = []
    for p in posts:
        rows.append(
            {
                "hash": content_hash(source, p.get("url", ""), p.get("text", "")[:2000]),
                "url": p.get("url"),
                "source": source,
                "content": p.get("text"),
                "meta": {k: v for k, v in p.items() if k != "text"},
                "rung": rung,
                "fetched_at": utcnow(),
            }
        )
    db.table("raw_posts").upsert(rows, on_conflict="hash").execute()
    return len(rows)


def record_run(
    db: Client,
    *,
    source: str,
    pages: int,
    parsed: int,
    rung: int,
    blocked: int = 0,
    errors: int = 0,
    error_text: str | None = None,
    duration_ms: int = 0,
) -> None:
    """Write one row per scrape pass. Columns follow 0003_core.sql."""
    now = datetime.now(timezone.utc)
    db.table("runs").insert(
        {
            "kind": "scrape",
            "status": "blocked" if blocked else ("error" if errors else "ok"),
            "rung": rung,
            "items_seen": parsed,
            "items_upserted": 0,
            "items_closed": 0,
            "items_failed": blocked,
            "spend": {"source": source, "pages": pages, "duration_ms": duration_ms},
            "error": error_text,
            "started_at": (now - timedelta(milliseconds=duration_ms)).isoformat(),
            "finished_at": now.isoformat(),
        }
    ).execute()


def upsert_source(
    db: Client,
    *,
    key: str,
    kind: str,
    label: str | None,
    url: str | None,
    review_state: str = "candidate",
    config: dict[str, Any] | None = None,
) -> None:
    """Register a discovered source, e.g. a public Facebook group.

    Discovery only ever writes `candidate`; a human promotes it to `approved`
    before anything is ingested from it (PLAN.md section 4.3).
    """
    db.table("sources").upsert(
        {
            "key": key,
            "kind": kind,
            "label": label,
            "url": url,
            "review_state": review_state,
            "config": config or {},
        },
        on_conflict="key",
    ).execute()


def approved_sources(db: Client, kind: str) -> list[dict[str, Any]]:
    res = (
        db.table("sources")
        .select("key, kind, label, url, config")
        .eq("kind", kind)
        .eq("review_state", "approved")
        .execute()
    )
    return res.data or []


def known_post_urls(db: Client, source: str = "facebook", limit: int = 5000) -> set[str]:
    """URLs already in `raw_posts`.

    Search results are stable between runs, so without this every pass would
    re-buy the same permalinks. Fetching is the expensive step, not searching.
    """
    seen: set[str] = set()
    page = 1000
    for offset in range(0, limit, page):
        res = (
            db.table("raw_posts")
            .select("url")
            .eq("source", source)
            .range(offset, offset + page - 1)
            .execute()
        )
        rows = res.data or []
        for r in rows:
            if r.get("url"):
                seen.add(r["url"].split("?")[0].rstrip("/"))
        if len(rows) < page:
            break
    return seen
