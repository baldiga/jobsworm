"""Scraping CLI.

    python -m jobswarm_scrape.cli workable
    python -m jobswarm_scrape.cli drushimavodot
    python -m jobswarm_scrape.cli fb-posts --limit 60
    python -m jobswarm_scrape.cli linkcheck --limit 500
    python -m jobswarm_scrape.cli balance

Every command accepts --dry-run, which fetches and parses but writes nothing.
fb-apify's dry run goes further and starts no actor at all, because Apify bills
for every post it returns whether or not it is stored.
Scraped postings land in `raw_pages` / `raw_posts`; `pnpm import:scraped`
turns them into `jobs`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

# `.env.local` holds the real keys and is git-ignored.
ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env.local")
load_dotenv(ROOT / ".env")

from .ladder import floppydata_balance  # noqa: E402
from .linkcheck import check_jobs  # noqa: E402
from .sources import drushimavodot  # noqa: E402
from .sources import revhub  # noqa: E402
from .sources import workable  # noqa: E402
from .serp import backend_name, search_many  # noqa: E402
from .sources import apify_groups, facebook  # noqa: E402
from .store import (  # noqa: E402
    approved_sources,
    client,
    known_post_urls,
    record_run,
    save_page,
    save_posts,
    upsert_source,
)


def _out(line: str) -> None:
    """Print without dying on a character the console cannot encode.

    Job titles are user-written and routinely contain emoji. On a Windows
    console defaulting to cp1255 a single rocket in a LinkedIn title raised
    UnicodeEncodeError and took down a whole scrape run AFTER the Apify call had
    already been paid for. The data was fine; only the printing failed.
    """
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        print(line.encode(enc, errors="replace").decode(enc), flush=True)


# Printed before every Facebook command. The same text is in the README and
# in the docstrings of sources/facebook.py and sources/apify_groups.py.
FACEBOOK_DISCLAIMER = (
    "NOTICE: Facebook sources read publicly visible group posts. Whether you may\n"
    "collect and republish them depends on your jurisdiction, Facebook's terms and\n"
    "the privacy law that applies to you, and is your responsibility alone. This\n"
    "code is provided as is, without warranty; you use it at your own risk."
)


def _facebook_notice() -> None:
    for line in FACEBOOK_DISCLAIMER.splitlines():
        _out(line)
    _out("")


async def cmd_fb_discover(args: argparse.Namespace) -> int:
    """Register discovered groups as candidates.

    Discovery itself is a Claude Code session (PLAN.md section 13): search,
    read the group pages, and write the results to a JSON file. This command
    loads that file so a human still approves every group before ingestion.
    """
    _facebook_notice()
    path = Path(args.file)
    if not path.exists():
        _out(f"no such file: {path}")
        return 1

    payload = json.loads(path.read_text(encoding="utf-8"))
    results = payload if isinstance(payload, list) else payload.get("results", [])
    candidates = facebook.candidates_from_results(results)
    _out(f"fb-discover: {len(candidates)} candidate groups from {len(results)} results")

    if args.dry_run:
        for c in candidates[:10]:
            _out(f"  - {c['config']['slug']:32} {c['label'][:50]}")
        return 0

    db = client()
    for c in candidates:
        upsert_source(db, **c)
    _out(f"  registered {len(candidates)} candidates (review_state=candidate)")
    _out("  approve with: update sources set review_state='approved' where key = ...")
    return 0


async def cmd_fb_scrape(args: argparse.Namespace) -> int:
    _facebook_notice()
    started = time.monotonic()
    db = None if args.dry_run else client()

    if args.slug:
        slugs = [args.slug]
    else:
        if db is None:
            db = client()
        rows = approved_sources(db, "facebook_group")
        # Each group costs one residential fetch, so spend the budget on the
        # richest groups first when --limit caps the run.
        rank = {"core": 0, "adjacent": 1, "broad": 2}
        rows.sort(key=lambda r: rank.get((r.get("config") or {}).get("tier"), 3))
        slugs = [r["config"].get("slug") for r in rows if r.get("config", {}).get("slug")]
        if args.limit:
            slugs = slugs[: args.limit]

    if not slugs:
        _out("fb-scrape: no approved groups. Run fb-discover, then approve some.")
        return 0

    _out(f"fb-scrape: {len(slugs)} approved group(s)")
    total = 0
    rung_used = 0
    all_notes: list[str] = []

    for slug in slugs:
        posts, rung, notes = await facebook.scrape_group(slug)
        rung_used = max(rung_used, rung)
        all_notes.extend(notes)
        _out(f"  {slug:34} {len(posts)} job-like post(s) at rung {rung}")
        for p in posts[: 2 if args.dry_run else 0]:
            _out(f"      {p['excerpt'][:110]}")
        if posts and not args.dry_run:
            assert db is not None
            total += save_posts(db, source="facebook", posts=posts, rung=rung)

    if not args.dry_run:
        assert db is not None
        record_run(
            db,
            source="facebook",
            pages=len(slugs),
            parsed=total,
            rung=rung_used,
            errors=len(all_notes),
            error_text="; ".join(all_notes)[:500] or None,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        _out(f"  stored {total} posts in raw_posts")
    return 0


async def cmd_fb_posts(args: argparse.Namespace) -> int:
    """Harvest individual post permalinks via search, then read each one.

    This is the high-volume path. A group feed shows two or three posts to a
    logged-out visitor; permalinks are unlimited and render in full, so the
    ceiling here is the search backend rather than Facebook.
    """
    _facebook_notice()
    started = time.monotonic()
    _out(f"fb-posts: search backend = {backend_name()}")

    hits, notes = await search_many(facebook.POST_QUERIES, count=20)
    permalinks = [h for h in hits if facebook.permalink_parts(h.url)]
    # Reject obvious non-tech on the SERP title before paying to fetch it.
    tech = [h for h in permalinks if facebook.title_looks_tech(h.title)]
    groups = {facebook.permalink_parts(h.url)[0] for h in permalinks}
    _out(
        f"  {len(hits)} results, {len(permalinks)} permalinks across {len(groups)} groups, "
        f"{len(tech)} look tech"
    )
    permalinks = tech
    for n in notes[:4]:
        _out(f"  note: {n}")

    # Search results barely move between runs, so skip anything already
    # stored. Fetching is what costs; searching is nearly free.
    if not args.dry_run or args.skip_known:
        known = known_post_urls(client(), "facebook")
        before = len(permalinks)
        permalinks = [h for h in permalinks if h.url.split("?")[0].rstrip("/") not in known]
        _out(f"  {before - len(permalinks)} already stored, {len(permalinks)} new")

    if args.limit:
        permalinks = permalinks[: args.limit]

    posts = []
    rung_used = 0
    for hit in permalinks:
        post, rung, err = await facebook.scrape_permalink(hit.url)
        rung_used = max(rung_used, rung)
        if err:
            notes.append(err)
            continue
        if post:
            posts.append(post)
            _out(f"    {post['excerpt'][:88]}")

    _out(f"  {len(posts)} job-like post(s) from {len(permalinks)} permalink(s)")

    if args.dry_run:
        return 0

    db = client()
    stored = save_posts(db, source="facebook", posts=posts, rung=rung_used) if posts else 0
    record_run(
        db,
        source="facebook:permalinks",
        pages=len(permalinks),
        parsed=stored,
        rung=rung_used,
        errors=len(notes),
        error_text="; ".join(notes)[:500] or None,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
    _out(f"  stored {stored} posts in raw_posts")
    return 0


async def cmd_fb_apify(args: argparse.Namespace) -> int:
    """Facebook groups through an Apify actor - their accounts, not ours."""
    _facebook_notice()
    started = time.monotonic()

    try:
        db = None if args.dry_run else client()

        # Earned per-group caps, keyed by URL. Populated from the registry in
        # both branches: --groups used to skip this and then read `caps` a few
        # lines below, so the one flag documented for cost pilots raised
        # UnboundLocalError every time it was used. It crashed before starting
        # a run, so it cost nothing but the pilot.
        caps: dict[str, int] = {}

        if args.groups:
            # An explicit list, for staged rollouts and cost pilots. Selecting
            # by --limit alone depends on registry ordering, which makes a
            # "run these ten" check neither exact nor repeatable.
            raw = [g.strip() for g in args.groups.split(",") if g.strip()]
            urls = [
                g if g.startswith("http") else f"https://www.facebook.com/groups/{g}/"
                for g in raw
            ]
            # A group named explicitly still gets the cap it has earned; the
            # point of --groups is to choose WHICH groups run, not to override
            # what measurement has already established about them.
            if db is not None:
                caps = {
                    r["url"]: int((r.get("config") or {}).get("max_posts") or 0)
                    for r in approved_sources(db, "facebook_group")
                    if r.get("url")
                }
        else:
            rows = approved_sources(db or client(), "facebook_group")
            rank = {"core": 0, "adjacent": 1, "broad": 2}
            rows.sort(key=lambda r: rank.get((r.get("config") or {}).get("tier"), 3))
            urls = [r["url"] for r in rows if r.get("url")]
            if args.limit:
                urls = urls[: args.limit]
            # A per-group cap, where one has been earned. See `by_cap` below.
            caps = {
                r["url"]: int((r.get("config") or {}).get("max_posts") or 0)
                for r in rows
                if r.get("url")
            }

        if not urls:
            _out("fb-apify: no approved groups")
            return 0

        if args.from_dataset:
            # Collect a run that has already been billed. Apify keeps running
            # server-side after a client timeout, so the results exist and are
            # paid for whether or not we ever asked for them.
            _out(f"fb-apify: collecting existing dataset {args.from_dataset}")
            items = await apify_groups.fetch_dataset(args.from_dataset)
            actor = apify_groups.actor_id()
            _out(f"  {len(items)} rows recovered")
            posts = [p for p in (apify_groups.to_post(i) for i in items) if p]
            _out(f"  {len(posts)} usable post(s)")
            if args.dry_run:
                return 0
            assert db is not None
            stored = save_posts(db, source="facebook", posts=posts, rung=0)
            _out(f"  stored {stored} posts in raw_posts")
            return 0

        """
        Groups are read in tiers, because they are not equally worth reading.

        `max_posts` was one number for all 185 groups. Measured against what
        actually became a listing, they range from 0% to 89% — so a flat cap
        either starves the good groups or pays for noise from the rest. The
        cap now comes from `sources.config.max_posts` where a group has earned
        one (>=20 posts of history, >=25 imported, >=50% conversion), and the
        CLI default otherwise.

        One actor run per distinct cap, since the actor takes a single
        `maxItems` for the whole run. Two runs, not 185.
        """
        by_cap: dict[int, list[str]] = {}
        for u in urls:
            by_cap.setdefault(caps.get(u) or args.max_posts, []).append(u)

        _out(
            f"fb-apify: actor={apify_groups.actor_id()}  groups={len(urls)}  "
            + "  ".join(f"cap{c}={len(g)}" for c, g in sorted(by_cap.items()))
        )

        # A dry run stops here. It used to start the actor and only skip the
        # database write, which made "--dry-run" the one flag in this CLI that
        # spent money: Apify bills every post it returns, stored or not. The
        # ceiling below is the most the real run could be billed for, at the
        # rate measured on the default actor (see apify_groups.py).
        if args.dry_run:
            ceiling = sum(cap * len(group) for cap, group in by_cap.items())
            _out(
                f"  dry run: no actor started. At most {ceiling} posts, "
                f"<= ${ceiling * 1.65 / 1000:.2f} at the measured memo23 rate."
            )
            return 0

        items = []
        actor = apify_groups.actor_id()
        for cap, group in sorted(by_cap.items(), reverse=True):
            got, actor = await apify_groups.run_actor(
                group,
                max_posts=cap,
                newer_than_hours=args.newer_than_hours,
                search=None if args.no_search else apify_groups.JOB_SEARCH_TERMS,
            )
            items.extend(got)
        _out(f"  {len(items)} rows returned")

        posts = [p for p in (apify_groups.to_post(i) for i in items) if p]
        _out(f"  {len(posts)} usable post(s)")

        assert db is not None
        stored = save_posts(db, source="facebook", posts=posts, rung=0)
        record_run(
            db,
            source=f"facebook:apify:{actor}",
            pages=len(urls),
            parsed=stored,
            rung=0,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        _out(f"  stored {stored} posts in raw_posts")
    except apify_groups.ApifyError as exc:
        _out(f"  apify: {exc}")
        return 1
    return 0

async def cmd_drushimavodot(args: argparse.Namespace) -> int:
    """Drushim-Avodot partner feed. Documented, free, structured JSON.

    A general jobs board, so the tech gate drops roughly 95% of it. That is the
    intended outcome, not a failure: the ~3% that is hi-tech arrives with real
    salaries, real publish dates and a real expiry, which is better data than
    any scraped board gives us.
    """
    started = time.monotonic()
    try:
        jobs = list(drushimavodot.iter_jobs(max_jobs=args.limit))
    except drushimavodot.FeedError as exc:
        _out(f"  drushimavodot: {exc}")
        return 1

    _out(f"drushimavodot: {len(jobs)} posting(s) from the feed")
    if args.dry_run:
        for j in jobs[:8]:
            _out(f"      {j.title[:80]}  [{(j.meta or {}).get('category')}]")
        return 0

    db = client()

    # One raw_pages row per feed page rather than one row for the whole feed.
    # The feed carries ~8,000 jobs; putting them in a single JSON column would
    # make one enormous row that the importer then has to read whole, which is
    # exactly the shape that has already tripped the statement timeout twice.
    # Each raw_pages row holds its batch as one JSON column, so the batch size
    # is really a row-size budget. 500 full job bodies exceeded the statement
    # timeout on write; the size that fits depends on how long the descriptions
    # happen to be, so halve and retry rather than guess a new constant.
    stored = 0
    start = 0
    chunk = 100
    while start < len(jobs):
        batch = jobs[start : start + chunk]
        try:
            stored += save_page(
                db,
                url=f"{drushimavodot.FEED}?offset={start}",
                source="drushimavodot",
                jobs=batch,
                rung=0,
                extra={"feed": "openapi", "offset": start, "count": len(batch)},
            )
        except Exception as exc:  # noqa: BLE001 - the driver wraps the PG error
            if "statement timeout" in str(exc).lower() and chunk > 10:
                chunk = max(10, chunk // 2)
                _out(f"  write too large, retrying at {chunk} per row")
                continue
            raise
        start += len(batch)
    record_run(
        db,
        source="drushimavodot",
        pages=1,
        parsed=stored,
        rung=0,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
    _out(f"  stored {stored} posting(s)")
    return 0


async def cmd_revhub(args: argparse.Namespace) -> int:
    """RevHub, a curated GTM jobs feed. Small, free, and hand-maintained.

    The whole file is 32 jobs, so there is no paging and no batching to get
    right. What there IS to get right is the privacy mapping — the feed carries
    people's personal email addresses and WhatsApp identifiers — and that lives
    in revhub.to_job(), which drops them before anything is written.

    `generated_at` is reported every run because it is the number that decides
    whether this source is worth anything on a given day. The feed is rebuilt by
    hand; when it stops being rebuilt, everything in it ages past the 30-day cap
    and this source quietly contributes nothing. Better to see that in the log
    than to wonder why the count never moves.
    """
    started = time.monotonic()
    try:
        payload = revhub.fetch()
    except revhub.FeedError as exc:
        _out(f"  revhub: {exc}")
        return 1

    jobs = [j for j in (revhub.to_job(r) for r in payload.get("jobs") or []) if j]
    if args.limit:
        jobs = jobs[: args.limit]

    stale = revhub.generated_at(payload)
    _out(f"revhub: {len(jobs)} posting(s) with an apply link, feed generated {stale}")
    dropped = len(payload.get("jobs") or []) - len(jobs)
    if dropped > 0:
        _out(f"  {dropped} dropped: no employer link, only a personal email or phone")

    if args.dry_run:
        for j in jobs[:8]:
            _out(f"      {j.title[:70]}  [{(j.meta or {}).get('feed_function')}]")
        return 0

    db = client()
    stored = save_page(
        db,
        url=revhub.FEED,
        source="revhub",
        jobs=jobs,
        rung=0,
        extra={"feed": "json", "generated_at": stale, "count": len(jobs)},
    )
    record_run(
        db,
        source="revhub",
        pages=1,
        parsed=stored,
        rung=0,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
    _out(f"  stored {stored} posting(s)")
    return 0


async def cmd_workable(args: argparse.Namespace) -> int:
    """Workable's aggregated public board, partitioned by city and by role.

    Unlike every other ATS here this is one endpoint covering all of Workable's
    customers, so there is no company list to maintain and a new Workable
    employer shows up on the next run by itself.

    The count to watch is the ratio in the log line. The board reports its own
    `totalSize` for Israel; we reach it by asking ~48 narrow questions and
    unioning the answers, because the API caps every answer at 20 rows and has
    no offset. If that ratio starts falling, the fix is more partitions —
    another handful of cities or role words — not a bigger `limit`, which the
    API rejects outright.
    """
    started = time.monotonic()

    jobs = list(workable.iter_jobs(max_jobs=args.limit))
    companies = {j.company_name for j in jobs if j.company_name}
    _out(
        f"workable: {len(jobs)} Israeli posting(s) from {len(companies)} "
        f"employer(s), via {len(workable.probes())} partitions"
    )

    if args.dry_run:
        for j in jobs[:8]:
            _out(f"      {j.title[:56]:<58} {j.location_raw[:34]}")
        return 0

    db = client()
    stored = save_page(
        db,
        url=workable.API,
        source="workable",
        jobs=jobs,
        rung=0,
        extra={
            "feed": "json",
            "partitions": len(workable.probes()),
            "count": len(jobs),
            "companies": len(companies),
        },
    )
    record_run(
        db,
        source="workable",
        pages=1,
        parsed=stored,
        rung=0,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
    _out(f"  stored {stored} posting(s)")
    return 0


async def cmd_linkcheck(args: argparse.Namespace) -> int:
    """Close listings whose source page says the job is gone.

    Works oldest-unchecked-first, so repeated runs sweep the whole index rather
    than re-checking the same rows. Anything inconclusive is left open on
    purpose; see linkcheck.py.
    """
    started = time.monotonic()
    db = client()

    rows = (
        db.table("jobs")
        .select("id, apply_url, source_url, source_provider")
        .eq("status", "open")
        # Never a listing somebody posted through us.
        #
        # The check reads the apply page and closes the job when it looks gone.
        # For a scraped listing that is the only freshness signal there is. For
        # a posted one it is wrong twice over: the campaign's own clock decides
        # when it ends, and an employer's careers site being briefly unreachable
        # would close a listing that was paid for — silently, on a schedule,
        # with the first anyone hears of it being a refund request.
        .not_.in_("source_provider", "(employer,agency)")
        .order("link_checked_at", desc=False, nullsfirst=True)
        .limit(args.limit)
        .execute()
        .data
        or []
    )
    if not rows:
        _out("linkcheck: nothing to check")
        return 0

    _out(f"linkcheck: {len(rows)} listing(s), oldest unchecked first")
    dead, alive = await check_jobs(rows, concurrency=args.concurrency)

    if args.dry_run:
        _out(f"  would close {len(dead)}, would mark {len(alive)} still live")
        for r in rows:
            if r["id"] in dead:
                _out(f"      dead: {r.get('apply_url') or r.get('source_url')}")
        return 0

    closed = 0
    if dead:
        closed = db.rpc("close_dead_jobs", {"p_ids": dead}).execute().data or 0
    if alive:
        db.rpc("touch_link_checked", {"p_ids": alive}).execute()

    inconclusive = len(rows) - len(dead) - len(alive)
    _out(f"  closed {closed} dead, {len(alive)} still live, {inconclusive} inconclusive")

    record_run(
        db,
        source="linkcheck",
        pages=len(rows),
        parsed=closed,
        rung=0,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
    return 0


async def cmd_balance(_args: argparse.Namespace) -> int:
    b = await floppydata_balance()
    web = b.get("webData", {}).get("requests", {})
    proxy = b.get("proxy", {}).get("rotating", {}).get("total", {}).get("traffic", {})
    _out(f"floppydata web-data requests: {web.get('remaining')} / {web.get('total')}")
    _out(f"floppydata proxy traffic    : {proxy.get('availableGb', 0)} GB")
    if not proxy.get("availableGb"):
        _out("  no proxy traffic: the cloud browser and proxied rungs are unavailable")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jobswarm-scrape")
    parser.add_argument("--dry-run", action="store_true", help="fetch and parse, write nothing")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("fb-discover", help="register discovered groups as candidates")
    p.add_argument("--file", required=True, help="JSON of discovered groups, a list or {results: [...]}")
    p.set_defaults(func=cmd_fb_discover)

    p = sub.add_parser("fb-scrape", help="read approved public groups")
    p.add_argument("--slug", help="scrape one group, ignoring approval state")
    p.add_argument("--limit", type=int, help="cap groups per pass, best tier first")
    p.set_defaults(func=cmd_fb_scrape)

    p = sub.add_parser("fb-posts", help="harvest post permalinks via search (high volume)")
    p.add_argument("--limit", type=int, help="cap permalinks fetched this pass")
    p.add_argument("--skip-known", action="store_true", help="dedupe during a dry run too")
    p.set_defaults(func=cmd_fb_posts)

    p = sub.add_parser("fb-apify", help="Facebook groups via an Apify actor")
    p.add_argument("--limit", type=int, help="cap groups per run")
    p.add_argument(
        "--max-posts",
        type=int,
        default=apify_groups.DEFAULT_MAX_POSTS,
        help="posts per group (a safety valve; groups average ~1.4 per two days)",
    )
    p.add_argument(
        "--newer-than-hours",
        type=int,
        default=apify_groups.DEFAULT_NEWER_THAN_HOURS,
        help="only posts from the last N hours. This is the setting that "
             "controls the bill: without it every sweep re-pays for the backlog",
    )
    p.add_argument("--no-search", action="store_true", help="do not filter to hiring keywords")
    p.add_argument(
        "--groups",
        help="comma-separated group slugs or URLs to run instead of the registry; "
             "use for cost pilots and staged rollouts",
    )
    p.add_argument(
        "--from-dataset",
        help="ingest an existing Apify dataset instead of starting a run, to "
             "recover a run that was billed but whose results were never collected",
    )
    p.set_defaults(func=cmd_fb_apify)

    p = sub.add_parser("drushimavodot", help="Drushim-Avodot partner feed (free, documented)")
    p.add_argument("--limit", type=int, default=None, help="cap postings this run")
    p.set_defaults(func=cmd_drushimavodot)

    p = sub.add_parser("revhub", help="RevHub curated GTM jobs feed (free)")
    p.add_argument("--limit", type=int, default=None, help="cap postings this run")
    p.set_defaults(func=cmd_revhub)

    p = sub.add_parser("workable", help="Workable's own aggregated board (free, robots-granted)")
    p.add_argument("--limit", type=int, default=None, help="cap postings this run")
    p.set_defaults(func=cmd_workable)

    p = sub.add_parser("linkcheck", help="close listings whose source page says the job is gone")
    p.add_argument("--limit", type=int, default=400, help="listings to check this run")
    p.add_argument("--concurrency", type=int, default=4, help="hosts checked in parallel")
    p.set_defaults(func=cmd_linkcheck)

    p = sub.add_parser("balance", help="check FloppyData balances")
    p.set_defaults(func=cmd_balance)

    args = parser.parse_args(argv)
    return asyncio.run(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
