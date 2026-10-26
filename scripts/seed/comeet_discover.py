#!/usr/bin/env python3
"""
comeet_discover.py — find a company's Comeet careers-API credentials.

Comeet (the #1 ATS in Israel) exposes a public, unauthenticated feed:

    GET https://www.comeet.co/careers-api/2.0/company/{uid}/positions?token={token}

Both `uid` and `token` are embedded, in the clear, in the JS that the
company's own public careers page ships to every visitor. Three shapes are
seen in the wild (all handled below):

 1. The fully-built API URL, e.g. in a fetch()/ajax call:
        https://www.comeet.co/careers-api/2.0/company/62.002/positions?token=2629...
 2. A `COMEET_*` / widget config object next to the embed script:
        <script src="https://www.comeet.co/careers/careers.js"></script>
        <div class="comeet-careers" data-uid="62.002" data-token="2629..."></div>
    or, most commonly, plain JS keys:
        uid: "62.002", token: "262988131015727264C41572E4C10AE10AE"
    `uid` is always NN.NNN hex-ish; `token` is a 20-45 char hex-ish string.
 3. Links to the Comeet-hosted board, which carry the slug and the uid:
        https://www.comeet.com/jobs/{slug}/{uid}
    (the hosted board page itself also contains the token, so we fetch it)

Verified examples found by this script:
    global-e.com/careers   -> uid 62.002  token 262988131015727264C41572E4C10AE10AE
    wsc-sports.com/careers -> uid 93.007  token 39711F3AC5AC539701CB81CB8204FE5C
    exodigo (hosted page)  -> uid 89.005  token 98542A398504C28391E130A391E391E2614

Usage:
    python comeet_discover.py --domains domains.txt --out comeet.json
    python comeet_discover.py --hosted slugs.txt   --out comeet.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import re
import sys

import httpx

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
H = {"User-Agent": UA,
     "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
     "Accept-Language": "en-US,en;q=0.9,he;q=0.8"}

RX_API = re.compile(
    r"careers-api/2\.0/company/([0-9A-Za-z.]+)/positions[^\"'<>\s]*token=([0-9A-Za-z.]+)")
RX_HOSTED = re.compile(
    r"comeet\.com/jobs/([A-Za-z0-9_\-.]+)/([0-9A-Fa-f]{2}\.[0-9A-Fa-f]{3})")
RX_UID = re.compile(
    r"""(?:uid|company_uid|companyUid|data-uid)['"]?\s*[:=]\s*['"]([0-9A-Fa-f]{2}\.[0-9A-Fa-f]{3})['"]""")
RX_TOK = re.compile(
    r"""(?:token|comeet_token|data-token)['"]?\s*[:=]\s*['"]([0-9A-Za-z.]{20,45})['"]""")
RX_SCRIPT = re.compile(
    r"""["'](https?://[^"']*comeet\.co[^"']*\.(?:js|json)[^"']*)["']""")
RX_HAS = re.compile(r"comeet", re.I)

PATHS = ["/careers", "/jobs", "/join-us", "/company/careers", "/"]


def api_url(uid: str, token: str) -> str:
    return (f"https://www.comeet.co/careers-api/2.0/company/{uid}"
            f"/positions?token={token}")


async def _get(client: httpx.AsyncClient, url: str, timeout: float = 20.0):
    try:
        return await client.get(url, headers=H, timeout=timeout,
                                follow_redirects=True)
    except Exception:  # noqa: BLE001
        return None


def extract(text: str) -> list[tuple[str, str]]:
    """Return candidate (uid, token) pairs found in a page."""
    pairs: list[tuple[str, str]] = []
    for uid, tok in RX_API.findall(text):
        pairs.append((uid, tok))
    uids = RX_UID.findall(text)
    toks = RX_TOK.findall(text)
    for u in uids[:3]:
        for t in toks[:3]:
            pairs.append((u, t))
    # slug/uid from a hosted-board link, token may still be missing
    out: list[tuple[str, str]] = []
    seen = set()
    for p in pairs:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def hosted_refs(text: str) -> list[tuple[str, str]]:
    return list(dict.fromkeys(RX_HOSTED.findall(text)))


class Discoverer:
    def __init__(self, concurrency: int = 10):
        self.sem = asyncio.Semaphore(concurrency)
        self.verify_sem = asyncio.Semaphore(8)

    async def verify(self, client: httpx.AsyncClient, uid: str, token: str):
        async with self.verify_sem:
            await asyncio.sleep(random.uniform(0.05, 0.2))
            r = await _get(client, api_url(uid, token))
        if r is None or r.status_code != 200:
            return None
        try:
            data = r.json()
        except Exception:  # noqa: BLE001
            return None
        if not isinstance(data, list) or not data:
            return None
        return data

    async def from_hosted(self, client: httpx.AsyncClient, slug: str,
                          uid: str):
        """Fetch the Comeet-hosted board page for slug/uid and pull the token."""
        async with self.sem:
            await asyncio.sleep(random.uniform(0.1, 0.3))
            r = await _get(client, f"https://www.comeet.com/jobs/{slug}/{uid}")
        if r is None or r.status_code != 200:
            return None
        for u, t in extract(r.text):
            if u == uid or True:
                jobs = await self.verify(client, uid, t)
                if jobs is not None:
                    return {"slug": slug, "uid": uid, "token": t, "jobs": jobs}
        return None

    async def from_domain(self, client: httpx.AsyncClient, name: str,
                          domain: str):
        for path in PATHS:
            async with self.sem:
                await asyncio.sleep(random.uniform(0.1, 0.3))
                r = await _get(client, f"https://{domain}{path}")
            if r is None or r.status_code >= 400 or not RX_HAS.search(r.text):
                continue
            text = r.text
            # follow a comeet-hosted script/json bundle once, if present
            for pair in extract(text):
                jobs = await self.verify(client, *pair)
                if jobs is not None:
                    return {"name": name, "domain": domain, "uid": pair[0],
                            "token": pair[1], "jobs": jobs,
                            "careers_url": f"https://{domain}{path}"}
            for slug, uid in hosted_refs(text):
                got = await self.from_hosted(client, slug, uid)
                if got:
                    got.update({"name": name, "domain": domain,
                                "careers_url": f"https://{domain}{path}"})
                    return got
            for src in RX_SCRIPT.findall(text)[:3]:
                async with self.sem:
                    r2 = await _get(client, src)
                if r2 is None or r2.status_code != 200:
                    continue
                for pair in extract(r2.text):
                    jobs = await self.verify(client, *pair)
                    if jobs is not None:
                        return {"name": name, "domain": domain,
                                "uid": pair[0], "token": pair[1], "jobs": jobs,
                                "careers_url": f"https://{domain}{path}"}
            break  # found a comeet page but no usable creds; stop probing paths
        return None


async def main_async(args) -> int:
    d = Discoverer(concurrency=args.concurrency)
    out: list[dict] = []
    limits = httpx.Limits(max_connections=60, max_keepalive_connections=30)
    async with httpx.AsyncClient(limits=limits, verify=False) as client:
        tasks = []
        if args.domains:
            for line in open(args.domains, encoding="utf-8"):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = [p.strip() for p in line.split("|")]
                name = parts[0]
                dom = parts[1] if len(parts) > 1 and parts[1] else None
                if dom:
                    tasks.append(d.from_domain(client, name, dom))
        if args.hosted:
            for line in open(args.hosted, encoding="utf-8"):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                slug, _, uid = line.partition("/")
                if slug and uid:
                    tasks.append(d.from_hosted(client, slug.strip(),
                                               uid.strip()))
        done = 0
        for fut in asyncio.as_completed(tasks):
            res = await fut
            done += 1
            if res:
                jobs = res.pop("jobs")
                res["jobs_total"] = len(jobs)
                res["locations"] = list({
                    (j.get("location") or {}).get("name") or ""
                    for j in jobs if isinstance(j, dict)})[:6]
                res["countries"] = sorted({
                    (j.get("location") or {}).get("country") or ""
                    for j in jobs if isinstance(j, dict)})
                res["jobs_israel"] = sum(
                    1 for j in jobs
                    if isinstance(j, dict)
                    and ((j.get("location") or {}).get("country") == "IL"
                         or "israel" in str((j.get("location") or {}).get("name", "")).lower()))
                out.append(res)
                print(f"  HIT {res.get('name') or res.get('slug')}: "
                      f"{res['uid']} jobs={res['jobs_total']} "
                      f"il={res['jobs_israel']}", file=sys.stderr, flush=True)
            if done % 50 == 0:
                print(f"  ... {done}/{len(tasks)} found={len(out)}",
                      file=sys.stderr, flush=True)
                with open(args.out, "w", encoding="utf-8") as f:
                    json.dump(out, f, ensure_ascii=False, indent=1)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"comeet boards found: {len(out)}", file=sys.stderr)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--domains", help="Name | domain lines")
    ap.add_argument("--hosted", help="slug/uid lines")
    ap.add_argument("--out", default="comeet.json")
    ap.add_argument("--concurrency", type=int, default=10)
    args = ap.parse_args()
    if not args.domains and not args.hosted:
        ap.error("need --domains or --hosted")
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    raise SystemExit(main())
