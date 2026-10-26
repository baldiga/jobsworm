#!/usr/bin/env python3
"""
verify_ats.py — brute-force verifier for public ATS job-board APIs.

Given candidate (provider, token) pairs it calls each provider's public,
unauthenticated job-board JSON endpoint concurrently and reports:
  * whether the board exists / returns jobs
  * total job count
  * how many of those jobs have an Israeli-looking location

All endpoints used here are the same public JSON feeds that power the
companies' own public careers pages. No auth, no login, no private data.

Usage
-----
  # verify an explicit candidate list (TSV/CSV: provider,token[,name,domain])
  python verify_ats.py --candidates candidates.csv --out results.json

  # brute-force: generate token variants from a company-name list
  python verify_ats.py --companies companies_candidates.txt --out results.json

  # single ad-hoc check
  python verify_ats.py --one greenhouse monday

Company list format (one per line, '#' comments allowed):
  Company Name | domain.com | optional,provider,hints | optional:explicit-token
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import random
import re
import sys
import unicodedata
from collections import defaultdict
from typing import Any, Iterable

import httpx

# --------------------------------------------------------------------------
# Israeli location detection
# --------------------------------------------------------------------------

IL_PATTERNS = [
    "israel", "ישראל", "isr",
    "tel aviv", "tel-aviv", "telaviv", "תל אביב", "tlv",
    "herzliya", "herzeliya", "hertzliya", "הרצליה",
    "ra'anana", "raanana", "ra anana", "רעננה",
    "petah tikva", "petach tikva", "petah-tikva", "petax tikva", "פתח תקווה",
    "haifa", "חיפה",
    "jerusalem", "ירושלים",
    "netanya", "nathanya", "נתניה",
    "beer sheva", "be'er sheva", "beersheba", "beer-sheva", "באר שבע",
    "yokneam", "yoqneam", "יקנעם",
    "caesarea", "קיסריה",
    "rehovot", "רחובות",
    "ramat gan", "ramat-gan", "רמת גן",
    "givatayim", "גבעתיים",
    "hod hasharon", "הוד השרון",
    "kfar saba", "kefar sava", "כפר סבא",
    "airport city", "עיר ימים",
    "modiin", "modi'in", "מודיעין",
    "rosh haayin", "rosh ha'ayin", "rosh ha ayin", "ראש העין",
    "holon", "חולון", "bnei brak", "בני ברק", "or yehuda", "אור יהודה",
    "ness ziona", "nes ziona", "נס ציונה", "rishon", "ראשון לציון",
    "lod", "לוד", "ashdod", "אשדוד", "ashkelon", "אשקלון",
    "migdal haemek", "מגדל העמק", "kiryat gat", "קרית גת", "kiryat ono",
    "hasharon", "sderot", "שדרות", "afula", "עפולה", "tirat carmel",
    "omer, ", "yavne", "יבנה", "raʼanana", "givat shmuel", "azrieli",
]
# guard against 'Israel' inside other words and against e.g. 'Lod' in 'Lodz'
IL_REGEXES = [re.compile(r"\b" + re.escape(p) + r"\b", re.I) for p in IL_PATTERNS]
IL_COUNTRY_CODES = {"il", "isr", "israel", "il-tel aviv"}


def is_israeli(text: str | None) -> bool:
    if not text:
        return False
    t = unicodedata.normalize("NFKC", str(text)).strip().lower()
    if not t:
        return False
    if t in IL_COUNTRY_CODES:
        return True
    for rx in IL_REGEXES:
        if rx.search(t):
            return True
    return False


# --------------------------------------------------------------------------
# Provider definitions
# --------------------------------------------------------------------------

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")

HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
}


def _flat_strings(obj: Any, keys: tuple[str, ...], depth: int = 0) -> list[str]:
    """Collect string values under any of `keys`, recursively (bounded)."""
    out: list[str] = []
    if depth > 4:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in keys:
                if isinstance(v, str):
                    out.append(v)
                elif isinstance(v, (dict, list)):
                    out.extend(_all_leaf_strings(v))
            elif isinstance(v, (dict, list)):
                out.extend(_flat_strings(v, keys, depth + 1))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(_flat_strings(v, keys, depth + 1))
    return out


def _all_leaf_strings(obj: Any, depth: int = 0) -> list[str]:
    out: list[str] = []
    if depth > 4:
        return out
    if isinstance(obj, str):
        return [obj]
    if isinstance(obj, dict):
        for v in obj.values():
            out.extend(_all_leaf_strings(v, depth + 1))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(_all_leaf_strings(v, depth + 1))
    return out


LOC_KEYS = ("location", "locations", "offices", "office", "city", "country",
            "countryCode", "region", "address", "addressLocality",
            "addressRegion", "addressCountry", "secondaryLocations",
            "allLocations", "location_name", "workplaceType", "locationName",
            "primaryLocation", "job_city", "job_country", "state")


def job_locations(job: Any) -> list[str]:
    """Location-ish strings only (never the description body)."""
    return _flat_strings(job, LOC_KEYS)


def parse_greenhouse(data: Any) -> list[Any] | None:
    if isinstance(data, dict) and isinstance(data.get("jobs"), list):
        return data["jobs"]
    return None


def parse_lever(data: Any) -> list[Any] | None:
    if isinstance(data, list):
        return data
    return None


def parse_ashby(data: Any) -> list[Any] | None:
    if isinstance(data, dict) and isinstance(data.get("jobs"), list):
        return data["jobs"]
    return None


def parse_workable(data: Any) -> list[Any] | None:
    if isinstance(data, dict) and isinstance(data.get("jobs"), list):
        return data["jobs"]
    return None


def parse_smartrecruiters(data: Any) -> list[Any] | None:
    if isinstance(data, dict) and isinstance(data.get("content"), list):
        return data["content"]
    return None


def parse_recruitee(data: Any) -> list[Any] | None:
    if isinstance(data, dict) and isinstance(data.get("offers"), list):
        return data["offers"]
    return None


def parse_comeet(data: Any) -> list[Any] | None:
    if isinstance(data, list):
        return data
    return None


def parse_personio(data: Any) -> list[Any] | None:  # XML, handled separately
    return None


PROVIDERS: dict[str, dict[str, Any]] = {
    "greenhouse": {
        "url": "https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true",
        "parse": parse_greenhouse,
        "host": "boards-api.greenhouse.io",
        "careers": "https://job-boards.greenhouse.io/{token}",
    },
    "lever": {
        "url": "https://api.lever.co/v0/postings/{token}?mode=json",
        "parse": parse_lever,
        "host": "api.lever.co",
        "careers": "https://jobs.lever.co/{token}",
    },
    "ashby": {
        "url": "https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true",
        "parse": parse_ashby,
        "host": "api.ashbyhq.com",
        "careers": "https://jobs.ashbyhq.com/{token}",
    },
    "workable": {
        "url": "https://apply.workable.com/api/v1/widget/accounts/{token}",
        "parse": parse_workable,
        "host": "apply.workable.com",
        "careers": "https://apply.workable.com/{token}/",
    },
    "smartrecruiters": {
        "url": "https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100",
        "parse": parse_smartrecruiters,
        "host": "api.smartrecruiters.com",
        "careers": "https://jobs.smartrecruiters.com/{token}",
    },
    "recruitee": {
        "url": "https://{token}.recruitee.com/api/offers/",
        "parse": parse_recruitee,
        "host": "recruitee.com",
        "careers": "https://{token}.recruitee.com/",
    },
    "comeet": {
        # token is "uid::token" — both are embedded in the company's own
        # careers-page JS (see scripts/seed/comeet_discover.py).
        "url": None,
        "parse": parse_comeet,
        "host": "www.comeet.co",
        "careers": None,
    },
}


def feed_url(provider: str, token: str) -> str:
    if provider == "comeet":
        uid, _, tok = token.partition("::")
        return (f"https://www.comeet.co/careers-api/2.0/company/{uid}"
                f"/positions?token={tok}")
    return PROVIDERS[provider]["url"].format(token=token)


def careers_url(provider: str, token: str, domain: str | None = None) -> str:
    if provider == "comeet":
        return f"https://{domain}/careers" if domain else ""
    tpl = PROVIDERS[provider].get("careers")
    return tpl.format(token=token) if tpl else ""


def host_of(provider: str) -> str:
    return PROVIDERS[provider]["host"]


# --------------------------------------------------------------------------
# Token generation
# --------------------------------------------------------------------------

DROP_WORDS = {
    "ltd", "inc", "corp", "corporation", "limited", "llc", "plc", "gmbh",
    "the", "and", "&",
}
SUFFIXES = [
    " israel", " technologies", " technology", " tech", " labs", " lab",
    " systems", " system", " software", " solutions", " group", " holdings",
    " ltd", " inc", " corp", " company", " co", " r&d", " rnd",
]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().strip()


def token_variants(name: str, domain: str | None = None,
                   wide: bool = True) -> list[str]:
    """Plausible ATS tokens for a company name.

    Most ATS tokens are the lowercased company name with punctuation stripped,
    but the long tail is wide: the bare domain (Ashby likes `viz.ai`), the
    domain stem, a hyphenated name, the name with a `com`/`ai`/`io`/`hq`/`il`
    suffix, or the first word alone. We generate all of those; a wrong guess
    costs one cheap 404.
    """
    out: list[str] = []
    n = _norm(name)

    bases = {n}
    for suf in SUFFIXES:
        if n.endswith(suf) and len(n) > len(suf) + 2:
            bases.add(n[: -len(suf)].strip())
    bases.add(re.sub(r"\.(com|io|ai|co|net|org)", "", n).strip())

    stems: list[str] = []
    if domain:
        d = domain.lower().split("/")[0]
        stem = d.split(".")[0]
        stems.append(stem)
        bases.add(stem.replace("-", " "))
        out += [d, stem, stem.replace("-", ""),
                re.sub(r"[^a-z0-9]", "", d)]

    joins: list[str] = []
    for b in bases:
        if not b:
            continue
        words = [w for w in re.split(r"[^a-z0-9']+", b) if w and w not in DROP_WORDS]
        if not words:
            continue
        joined = "".join(words)
        hyphen = "-".join(words)
        joins.append(joined)
        out += [joined, hyphen, joined.replace("'", ""),
                hyphen.replace("'", ""), re.sub(r"[^a-z0-9]", "", b)]
        if len(words) > 1:
            out.append(words[0])

    for base in list(dict.fromkeys(joins + stems))[:3]:
        if not base:
            continue
        if not wide:
            break
        for suf in ("com", "ai", "io", "hq", "il", "israel", "jobs"):
            out.append(base + suf)

    seen: list[str] = []
    for t in out:
        t = t.strip("-").strip()
        if t and 2 <= len(t) <= 45 and t not in seen:
            seen.append(t)
    return seen[:16] if wide else seen[:6]


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------


class Verifier:
    def __init__(self, per_host: int = 10, timeout: float = 25.0):
        self.per_host = per_host
        self.timeout = timeout
        self.sems: dict[str, asyncio.Semaphore] = defaultdict(
            lambda: asyncio.Semaphore(per_host))

    async def check(self, client: httpx.AsyncClient, provider: str,
                    token: str, meta: dict | None = None) -> dict:
        meta = meta or {}
        url = feed_url(provider, token)
        sem = self.sems[host_of(provider)]
        rec = {
            "provider": provider, "token": token, "url": url,
            "ok": False, "status": None, "jobs_total": 0, "jobs_israel": 0,
            "error": None, "sample_locations": [],
            **meta,
        }
        async with sem:
            await asyncio.sleep(random.uniform(0.05, 0.25))
            try:
                r = await client.get(url, headers=HEADERS,
                                     timeout=self.timeout,
                                     follow_redirects=True)
            except Exception as e:  # noqa: BLE001
                rec["error"] = f"{type(e).__name__}"
                return rec
        rec["status"] = r.status_code
        if r.status_code != 200:
            return rec
        try:
            data = r.json()
        except Exception:  # noqa: BLE001
            rec["error"] = "not-json"
            return rec
        jobs = PROVIDERS[provider]["parse"](data)
        if jobs is None:
            rec["error"] = "unexpected-shape"
            return rec
        rec["ok"] = True
        rec["jobs_total"] = len(jobs)
        il = 0
        samples: list[str] = []
        for j in jobs:
            locs = job_locations(j)
            hit = any(is_israeli(x) for x in locs)
            if hit:
                il += 1
                if len(samples) < 3:
                    for x in locs:
                        if is_israeli(x):
                            samples.append(x[:80])
                            break
        rec["jobs_israel"] = il
        rec["sample_locations"] = samples
        # board name, when the API exposes it (helps confirm identity)
        if isinstance(data, dict):
            for k in ("name", "title", "companyName", "company_name"):
                if isinstance(data.get(k), str):
                    rec["board_name"] = data[k]
                    break
        return rec


async def run_all(cands: list[tuple[str, str, dict]], per_host: int = 10,
                  progress: bool = True, jsonl: str | None = None) -> list[dict]:
    """Run every candidate. Results are appended to `jsonl` as they land so a
    long run survives an interruption."""
    v = Verifier(per_host=per_host)
    limits = httpx.Limits(max_connections=80, max_keepalive_connections=40)
    results: list[dict] = []
    fh = open(jsonl, "a", encoding="utf-8") if jsonl else None
    try:
        async with httpx.AsyncClient(limits=limits, http2=False) as client:
            tasks = [v.check(client, p, t, m) for p, t, m in cands]
            done = 0
            for fut in asyncio.as_completed(tasks):
                rec = await fut
                results.append(rec)
                if fh:
                    fh.write(json.dumps(rec, ensure_ascii=False) + chr(10))
                done += 1
                if done % 250 == 0:
                    if fh:
                        fh.flush()
                    if progress:
                        hits = sum(1 for r in results
                                   if r["ok"] and r["jobs_israel"] > 0)
                        print(f"  ... {done}/{len(tasks)}  hits={hits}",
                              file=sys.stderr, flush=True)
    finally:
        if fh:
            fh.close()
    return results


# --------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------


def load_companies(path: str) -> list[dict]:
    rows: list[dict] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("|")]
            name = parts[0]
            domain = parts[1] if len(parts) > 1 and parts[1] else None
            hints = parts[2] if len(parts) > 2 and parts[2] else ""
            explicit = parts[3] if len(parts) > 3 and parts[3] else ""
            rows.append({"name": name, "domain": domain,
                         "providers": [h.strip() for h in hints.split(",") if h.strip()],
                         "token": explicit})
    return rows


def build_candidates(rows: list[dict], providers: list[str],
                     already: set[tuple[str, str]] | None = None
                     ) -> list[tuple[str, str, dict]]:
    already = already or set()
    out: list[tuple[str, str, dict]] = []
    seen: set[tuple[str, str]] = set(already)
    for r in rows:
        provs = r["providers"] or providers
        wide_t = ([r["token"]] if r["token"]
                  else token_variants(r["name"], r["domain"], wide=True))
        narrow_t = ([r["token"]] if r["token"]
                    else token_variants(r["name"], r["domain"], wide=False))
        for p in provs:
            if p not in PROVIDERS:
                continue
            toks = wide_t if p in ("greenhouse", "ashby", "lever") else narrow_t
            for t in toks:
                key = (p, t)
                if key in seen:
                    continue
                seen.add(key)
                out.append((p, t, {"name": r["name"], "domain": r["domain"]}))
    return out


def load_pairs(path: str) -> list[tuple[str, str, dict]]:
    out: list[tuple[str, str, dict]] = []
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.reader(f):
            if not row or row[0].startswith("#"):
                continue
            p = row[0].strip()
            t = row[1].strip()
            meta = {}
            if len(row) > 2:
                meta["name"] = row[2].strip()
            if len(row) > 3:
                meta["domain"] = row[3].strip()
            out.append((p, t, meta))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--companies")
    ap.add_argument("--candidates")
    ap.add_argument("--one", nargs=2, metavar=("PROVIDER", "TOKEN"))
    ap.add_argument("--providers", default="greenhouse,lever,ashby,workable,"
                                           "smartrecruiters,recruitee")
    ap.add_argument("--out", default="results.json")
    ap.add_argument("--per-host", type=int, default=10)
    ap.add_argument("--skip-tried", action="append", default=[],
                    help="previous results.json/.jsonl to skip pairs from "
                         "(repeatable)")
    ap.add_argument("--jsonl", help="append every result here as it lands")
    args = ap.parse_args()

    providers = [p.strip() for p in args.providers.split(",") if p.strip()]
    cands: list[tuple[str, str, dict]] = []

    if args.one:
        cands = [(args.one[0], args.one[1], {})]
    else:
        already: set[tuple[str, str]] = set()
        for path in args.skip_tried:
            if not os.path.exists(path):
                continue
            if path.endswith(".jsonl"):
                for line in open(path, encoding="utf-8"):
                    line = line.strip()
                    if line:
                        rec = json.loads(line)
                        already.add((rec["provider"], rec["token"]))
            else:
                for rec in json.load(open(path, encoding="utf-8")):
                    already.add((rec["provider"], rec["token"]))
        if args.companies:
            cands += build_candidates(load_companies(args.companies), providers,
                                      already)
        if args.candidates:
            for p, t, m in load_pairs(args.candidates):
                if (p, t) not in already:
                    already.add((p, t))
                    cands.append((p, t, m))

    if not cands:
        print("no candidates", file=sys.stderr)
        return 1

    print(f"testing {len(cands)} (provider, token) pairs ...", file=sys.stderr)
    results = asyncio.run(run_all(cands, per_host=args.per_host,
                                  jsonl=args.jsonl))
    hits = [r for r in results if r["ok"] and r["jobs_israel"] > 0]
    boards = [r for r in results if r["ok"] and r["jobs_total"] > 0]
    print(f"boards found: {len(boards)}   with Israeli jobs: {len(hits)}",
          file=sys.stderr)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    for r in sorted(hits, key=lambda x: -x["jobs_israel"])[:40]:
        print(f"  {r['jobs_israel']:>4} IL / {r['jobs_total']:>4}  "
              f"{r['provider']:<16} {r['token']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
