#!/usr/bin/env python3
"""
detect_ats.py — find which public ATS a company uses by reading its own
careers page, then verify the ATS feed actually returns jobs.

Far higher yield than guessing tokens: a company's public careers page almost
always either links to, iframes, or fetches its ATS board, and the board token
is right there in the URL.

Fingerprints (all from the public HTML the careers page serves to any visitor):

    boards.greenhouse.io/{token}            job-boards.greenhouse.io/{token}
    boards.eu.greenhouse.io/{token}         job-boards.eu.greenhouse.io/{token}
    boards-api.greenhouse.io/v1/boards/{token}
    greenhouse.io/embed/job_board?for={token}
    jobs.lever.co/{token}                   api.lever.co/v0/postings/{token}
    jobs.ashbyhq.com/{token}                api.ashbyhq.com/posting-api/job-board/{token}
    apply.workable.com/{token}              apply.workable.com/api/v1/widget/accounts/{token}
    jobs.smartrecruiters.com/{token}        api.smartrecruiters.com/v1/companies/{token}
    {token}.recruitee.com
    comeet.co/careers-api/2.0/company/{uid}/positions?token={tok}   (uid::token)
    comeet.com/jobs/{slug}/{uid}   + token from that hosted page

Output: JSON list of {name, domain, careers_url, provider, token, jobs_total,
jobs_israel} for every company whose feed verified with >= 1 job.

Usage:
    python detect_ats.py --companies companies_candidates.txt --out detected.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import re
import sys

import httpx

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
from verify_ats import (  # noqa: E402
    HEADERS, PROVIDERS, feed_url, is_israeli, job_locations,
)

H = {**HEADERS,
     "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}

PATHS = ["/careers", "/jobs", "/company/careers", "/about/careers",
         "/join-us", "/careers/open-positions", "/open-positions",
         "/careers/jobs", "/he/careers", "/"]
# some companies host the board on a dedicated sub-domain instead
SUBDOMAINS = ["careers.", "jobs."]

FINGERPRINTS: list[tuple[str, re.Pattern]] = [
    ("greenhouse", re.compile(
        r"(?:job-)?boards(?:-api)?(?:\.eu)?\.greenhouse\.io/(?:v1/boards/)?"
        r"(?:embed/job_board\?for=)?([A-Za-z0-9_.\-]{2,40})")),
    ("greenhouse", re.compile(r"greenhouse\.io/embed/job_board\?for=([A-Za-z0-9_.\-]{2,40})")),
    ("lever", re.compile(r"(?:jobs\.lever\.co|api\.lever\.co/v0/postings)/([A-Za-z0-9_.\-]{2,40})")),
    ("ashby", re.compile(
        r"(?:jobs\.ashbyhq\.com|api\.ashbyhq\.com/posting-api/job-board)/([A-Za-z0-9_.\-]{2,40})")),
    ("workable", re.compile(
        r"apply\.workable\.com/(?:api/v\d/(?:widget/)?accounts/)?([A-Za-z0-9_.\-]{2,40})")),
    ("smartrecruiters", re.compile(
        r"(?:jobs\.smartrecruiters\.com|api\.smartrecruiters\.com/v1/companies)/([A-Za-z0-9_.\-]{2,40})")),
    ("recruitee", re.compile(r"([A-Za-z0-9_\-]{2,40})\.recruitee\.com")),
]

RX_COMEET_API = re.compile(
    r"careers-api/2\.0/company/([0-9A-Za-z.]+)/positions[^\"'<>\s]*token=([0-9A-Za-z.]+)")
RX_COMEET_HOSTED = re.compile(
    r"comeet\.com/jobs/([A-Za-z0-9_\-.]+)/([0-9A-Fa-f]{2}\.[0-9A-Fa-f]{3})")
RX_COMEET_UID = re.compile(
    r"""(?:uid|company_uid|companyUid|data-uid)['"]?\s*[:=]\s*['"]([0-9A-Fa-f]{2}\.[0-9A-Fa-f]{3})['"]""")
RX_COMEET_TOK = re.compile(
    r"""(?:token|comeet_token|data-token)['"]?\s*[:=]\s*['"]([0-9A-Za-z.]{20,45})['"]""")

JUNK = {"embed", "job_board", "jobs", "v1", "boards", "api", "www", "posting-api",
        "job-board", "accounts", "widget", "companies", "postings", "static",
        "assets", "css", "js", "images", "img", "en", "he", "careers", "search",
        "for", "token", "index", "app", "cdn", "s", "u", "e", "public"}


def clean(tok: str) -> str | None:
    t = tok.strip().strip(".-_").lower()
    if not t or t in JUNK or len(t) < 2 or len(t) > 40:
        return None
    if t.endswith((".js", ".css", ".png", ".svg", ".json", ".html")):
        return None
    return t


def fingerprints(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for prov, rx in FINGERPRINTS:
        for m in rx.findall(text):
            t = clean(m)
            if t and (prov, t) not in out:
                out.append((prov, t))
    return out


class Detector:
    def __init__(self, concurrency: int = 24):
        self.sem = asyncio.Semaphore(concurrency)
        self.vsem = asyncio.Semaphore(10)

    async def _get(self, client, url, timeout=18.0):
        async with self.sem:
            await asyncio.sleep(random.uniform(0.05, 0.2))
            try:
                return await client.get(url, headers=H, timeout=timeout,
                                        follow_redirects=True)
            except Exception:  # noqa: BLE001
                return None

    async def verify(self, client, provider: str, token: str):
        url = feed_url(provider, token)
        async with self.vsem:
            await asyncio.sleep(random.uniform(0.05, 0.15))
            try:
                r = await client.get(url, headers=HEADERS, timeout=25,
                                     follow_redirects=True)
            except Exception:  # noqa: BLE001
                return None
        if r.status_code != 200:
            return None
        try:
            data = r.json()
        except Exception:  # noqa: BLE001
            return None
        jobs = PROVIDERS[provider]["parse"](data)
        if not jobs:
            return None
        il = 0
        for j in jobs:
            if any(is_israeli(x) for x in job_locations(j)):
                il += 1
        return {"jobs_total": len(jobs), "jobs_israel": il}

    async def comeet_from_hosted(self, client, slug: str, uid: str):
        r = await self._get(client, f"https://www.comeet.com/jobs/{slug}/{uid}")
        if r is None or r.status_code != 200:
            return None
        for tok in RX_COMEET_TOK.findall(r.text)[:4]:
            got = await self.verify(client, "comeet", f"{uid}::{tok}")
            if got:
                return f"{uid}::{tok}", got
        return None

    async def probe(self, client, name: str, domain: str):
        found: list[dict] = []
        seen: set[tuple[str, str]] = set()
        pages = 0
        urls = [f"https://{domain}{p}" for p in PATHS]
        urls += [f"https://{sd}{domain}/" for sd in SUBDOMAINS]
        for url in urls:
            path = url[len("https://"):].replace(domain, "") or "/"
            r = await self._get(client, url)
            if r is None or r.status_code >= 400:
                continue
            text = r.text
            pages += 1
            cands = fingerprints(text)
            for prov, tok in cands:
                if (prov, tok) in seen:
                    continue
                seen.add((prov, tok))
                got = await self.verify(client, prov, tok)
                if got:
                    found.append({"name": name, "domain": domain,
                                  "careers_url": url,
                                  "provider": prov, "token": tok, **got})
            for uid, tok in RX_COMEET_API.findall(text):
                key = ("comeet", f"{uid}::{tok}")
                if key in seen:
                    continue
                seen.add(key)
                got = await self.verify(client, "comeet", f"{uid}::{tok}")
                if got:
                    found.append({"name": name, "domain": domain,
                                  "careers_url": url,
                                  "provider": "comeet", "token": f"{uid}::{tok}",
                                  **got})
            if not any(f["provider"] == "comeet" for f in found):
                uids = RX_COMEET_UID.findall(text)
                toks = RX_COMEET_TOK.findall(text)
                for u in uids[:2]:
                    for t in toks[:3]:
                        key = ("comeet", f"{u}::{t}")
                        if key in seen:
                            continue
                        seen.add(key)
                        got = await self.verify(client, "comeet", f"{u}::{t}")
                        if got:
                            found.append({
                                "name": name, "domain": domain,
                                "careers_url": url,
                                "provider": "comeet", "token": f"{u}::{t}",
                                **got})
                            break
                    if any(f["provider"] == "comeet" for f in found):
                        break
                if not any(f["provider"] == "comeet" for f in found):
                    for slug, uid in RX_COMEET_HOSTED.findall(text)[:2]:
                        got = await self.comeet_from_hosted(client, slug, uid)
                        if got:
                            tok, stats = got
                            found.append({
                                "name": name, "domain": domain,
                                "careers_url": url,
                                "provider": "comeet", "token": tok, **stats})
                            break
            if found:
                break
            if pages >= 6:
                break
        return found


async def main_async(args) -> int:
    rows: list[tuple[str, str]] = []
    for line in open(args.companies, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) > 1 and parts[1]:
            rows.append((parts[0], parts[1].lower()))
    # dedupe by domain
    seen: set[str] = set()
    uniq: list[tuple[str, str]] = []
    for n, d in rows:
        if d not in seen:
            seen.add(d)
            uniq.append((n, d))
    if args.skip:
        try:
            prev = json.load(open(args.skip, encoding="utf-8"))
            done = {r["domain"] for r in prev}
            uniq = [(n, d) for n, d in uniq if d not in done]
        except Exception:  # noqa: BLE001
            pass
    print(f"probing {len(uniq)} domains", file=sys.stderr, flush=True)

    det = Detector(concurrency=args.concurrency)
    out: list[dict] = []
    limits = httpx.Limits(max_connections=80, max_keepalive_connections=40)
    async with httpx.AsyncClient(limits=limits, verify=False) as client:
        tasks = [det.probe(client, n, d) for n, d in uniq]
        done = 0
        for fut in asyncio.as_completed(tasks):
            res = await fut
            done += 1
            for r in res:
                out.append(r)
                print(f"  HIT {r['domain']:32} {r['provider']:16}"
                      f"{r['token'][:40]:42} {r['jobs_israel']}/{r['jobs_total']}",
                      file=sys.stderr, flush=True)
            if done % 40 == 0:
                print(f"  ... {done}/{len(tasks)} found={len(out)}",
                      file=sys.stderr, flush=True)
                with open(args.out, "w", encoding="utf-8") as f:
                    json.dump(out, f, ensure_ascii=False, indent=1)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"detected boards: {len(out)}", file=sys.stderr)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--companies", required=True)
    ap.add_argument("--out", default="detected.json")
    ap.add_argument("--concurrency", type=int, default=24)
    ap.add_argument("--skip", help="previous detected.json to skip domains from")
    args = ap.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    raise SystemExit(main())
