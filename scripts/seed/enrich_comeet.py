#!/usr/bin/env python3
"""
enrich_comeet.py — add real company name + domain to comeet_discover output.

The Comeet positions feed carries two fields that identify the employer
without any guessing:

    company_name    e.g. "Coralogix"
    url_active_page e.g. https://coralogix.com/careers/co/ramat-gan-israel/...
                    (the company's OWN careers page when they embed the widget;
                     falls back to www.comeet.com when they use the hosted board)

So we take the name verbatim and the domain from url_active_page's host,
ignoring comeet.com / comeet.co hosts.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import sys
from collections import Counter
from urllib.parse import urlparse

import httpx

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
H = {"User-Agent": UA, "Accept": "application/json"}
API = "https://www.comeet.co/careers-api/2.0/company/{uid}/positions?token={token}"
SKIP_HOSTS = {"comeet.com", "www.comeet.com", "comeet.co", "www.comeet.co",
              "comeetapply.com"}

IL_CITY = ("israel", "tel aviv", "tel-aviv", "herzliya", "raanana", "ra'anana",
           "petah", "petach", "haifa", "jerusalem", "netanya", "beer sheva",
           "be'er sheva", "yokneam", "yoqneam", "caesarea", "rehovot",
           "ramat gan", "givatayim", "hod hasharon", "kfar saba", "modiin",
           "rosh ha", "holon", "bnei brak", "or yehuda", "ness ziona",
           "nes ziona", "rishon", "airport city", "yavne", "ashdod",
           "migdal haemek", "kiryat", "lod", "תל אביב", "ישראל", "הרצליה")


def israeli(loc: dict) -> bool:
    if not isinstance(loc, dict):
        return False
    if (loc.get("country") or "").upper() == "IL":
        return True
    blob = " ".join(str(loc.get(k) or "") for k in
                    ("name", "city", "state", "country")).lower()
    return any(c in blob for c in IL_CITY)


async def one(client: httpx.AsyncClient, rec: dict, sem: asyncio.Semaphore) -> dict | None:
    async with sem:
        await asyncio.sleep(random.uniform(0.05, 0.25))
        try:
            r = await client.get(API.format(uid=rec["uid"], token=rec["token"]),
                                 headers=H, timeout=25)
        except Exception:  # noqa: BLE001
            return None
    if r.status_code != 200:
        return None
    try:
        jobs = r.json()
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(jobs, list) or not jobs:
        return None

    names = Counter(j.get("company_name") for j in jobs
                    if isinstance(j, dict) and j.get("company_name"))
    hosts = Counter()
    for j in jobs:
        if not isinstance(j, dict):
            continue
        for key in ("url_active_page", "url_detected_page"):
            u = j.get(key)
            if not u:
                continue
            h = (urlparse(u).hostname or "").lower()
            if h and h not in SKIP_HOSTS and not h.endswith(".comeet.co"):
                hosts[h.removeprefix("www.")] += 1

    il = sum(1 for j in jobs if israeli((j or {}).get("location") or {}))
    out = dict(rec)
    out["name"] = names.most_common(1)[0][0] if names else rec.get("name") or rec.get("slug")
    if hosts:
        out["domain"] = hosts.most_common(1)[0][0]
    out["jobs_total"] = len(jobs)
    out["jobs_israel"] = il
    if hosts:
        out["careers_url"] = f"https://{out['domain']}/careers"
    elif rec.get("slug"):
        out["careers_url"] = f"https://www.comeet.com/jobs/{rec['slug']}/{rec['uid']}"
    return out


async def run(paths: list[str], out_path: str, conc: int) -> None:
    recs: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for p in paths:
        try:
            for r in json.load(open(p, encoding="utf-8")):
                k = (r["uid"], r["token"])
                if k not in seen:
                    seen.add(k)
                    recs.append(r)
        except Exception as e:  # noqa: BLE001
            print(f"skip {p}: {e}", file=sys.stderr)
    sem = asyncio.Semaphore(conc)
    res: list[dict] = []
    async with httpx.AsyncClient(verify=False) as client:
        for fut in asyncio.as_completed([one(client, r, sem) for r in recs]):
            v = await fut
            if v:
                res.append(v)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    with_dom = sum(1 for r in res if r.get("domain"))
    print(f"enriched {len(res)}/{len(recs)}; with real domain: {with_dom}; "
          f"with IL jobs: {sum(1 for r in res if r['jobs_israel'] > 0)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--conc", type=int, default=8)
    a = ap.parse_args()
    asyncio.run(run(a.inputs, a.out, a.conc))
    return 0


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    raise SystemExit(main())
