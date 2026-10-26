#!/usr/bin/env python3
"""
merge_seed.py — union every verification artifact into the final seed.

Reads, from every work directory given with --work (default: data/_seed_work
and data/_seed_work2):

  *.json     verify_ats.py result arrays   (provider/token/ok/jobs_*/name/domain)
  tried.jsonl  the same records, one per line
  comeet*.json comeet_discover.py / enrich_comeet.py output (uid/token/...)

Keeps an entry only when the feed call succeeded AND at least one returned job
has an Israeli-looking location. Dedupes on `domain` (canonical key per
PLAN.md 4.1), keeping the board with the most Israeli jobs, and unions the
`sources[]` of the losers. Writes data/companies.seed.json + data/seed-report.md.

Companies whose domain is unknown (search-harvested tokens) get one cheap
resolution pass: candidate hostnames derived from the board's company name are
probed with HEAD, and the first that serves is used.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

import httpx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_ats import careers_url, feed_url  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TLDS = [".com", ".io", ".ai", ".co", ".co.il", ".net", ".tech", ".security",
        ".health", ".dev", ".app", ".vision", ".auto", ".org", ".cloud", ".vc"]
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")

# Boards that exist but are demo/sandbox accounts, or where the token clearly
# belongs to a different company than the candidate name that found it.
BLOCK_TOKENS = {("comeet", "E5.007"), ("comeet", "80.003")}
BLOCK_DOMAINS = {"comeet.com", "example.com", "sandbox.com"}


def nd(d: str | None) -> str:
    if not d:
        return ""
    d = re.sub(r"^https?://", "", d.strip().lower())
    d = re.sub(r"^www\.", "", d)
    return d.split("/")[0].strip()


def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\b(ltd|inc|corp|limited|llc|plc|gmbh|israel|technologies|"
               r"technology|group|holdings|software|systems|labs?|company)\b",
               " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def load_name_map() -> dict[str, str]:
    m: dict[str, str] = {}
    sd = os.path.join(ROOT, "scripts", "seed")
    for fn in sorted(os.listdir(sd)):
        if not fn.startswith("companies_candidates"):
            continue
        for line in open(os.path.join(sd, fn), encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            p = [x.strip() for x in line.split("|")]
            if len(p) > 1 and p[1]:
                m.setdefault(norm_name(p[0]), nd(p[1]))
    return m


def iter_records(work_dirs: list[str]):
    """Yield ('ats'|'comeet', record) from every artifact we can find."""
    for wd in work_dirs:
        if not os.path.isdir(wd):
            continue
        for fn in sorted(os.listdir(wd)):
            path = os.path.join(wd, fn)
            if fn.endswith(".jsonl"):
                for line in open(path, encoding="utf-8"):
                    line = line.strip()
                    if line:
                        try:
                            yield "ats", json.loads(line)
                        except Exception:  # noqa: BLE001
                            pass
                continue
            if not fn.endswith(".json"):
                continue
            try:
                data = json.load(open(path, encoding="utf-8"))
            except Exception:  # noqa: BLE001
                continue
            if not isinstance(data, list):
                continue
            for r in data:
                if not isinstance(r, dict):
                    continue
                if "uid" in r and "token" in r and "provider" not in r:
                    yield "comeet", r
                elif "provider" in r and "token" in r:
                    yield "ats", r


async def resolve(rows: list[dict], conc: int = 10) -> None:
    sem = asyncio.Semaphore(conc)

    async def one(client: httpx.AsyncClient, r: dict) -> None:
        stems: list[str] = []
        for cand in (r.get("name"), r.get("token")):
            if not cand:
                continue
            n = unicodedata.normalize("NFKD", str(cand))
            n = "".join(c for c in n if not unicodedata.combining(c)).lower()
            n = re.sub(r"\b(ltd|inc|corp|limited|llc|plc|gmbh)\b", " ", n)
            w = [x for x in re.split(r"[^a-z0-9]+", n) if x]
            if not w:
                continue
            stems.append("".join(w))
            if len(w) > 1:
                stems.append("-".join(w))
        seen: list[str] = []
        for s in stems:
            if s and s not in seen and 2 < len(s) < 30:
                seen.append(s)
        async with sem:
            for stem in seen[:2]:
                for tld in TLDS:
                    host = stem + tld
                    try:
                        resp = await client.head(f"https://{host}", timeout=6,
                                                 follow_redirects=True)
                    except Exception:  # noqa: BLE001
                        continue
                    if resp.status_code < 400:
                        r["domain"] = nd(str(resp.url).split("//")[-1]) or host
                        return

    todo = [r for r in rows if not r.get("domain")]
    if not todo:
        return
    print(f"resolving {len(todo)} unknown domains ...", file=sys.stderr)
    async with httpx.AsyncClient(verify=False,
                                 headers={"User-Agent": UA}) as client:
        await asyncio.gather(*(one(client, r) for r in todo))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", nargs="*",
                    default=[os.path.join(ROOT, "data", "_seed_work"),
                             os.path.join(ROOT, "data", "_seed_work2")])
    ap.add_argument("--out", default=os.path.join(ROOT, "data",
                                                  "companies.seed.json"))
    ap.add_argument("--report", default=os.path.join(ROOT, "data",
                                                     "seed-report.md"))
    a = ap.parse_args()

    name_map = load_name_map()
    hits: list[dict] = []
    seen_pairs: set[tuple[str, str]] = set()
    tried: set[tuple[str, str]] = set()
    failed: set[tuple[str, str]] = set()
    exists_no_il: set[tuple[str, str]] = set()

    for kind, r in iter_records(a.work):
        if kind == "ats":
            key = (r["provider"], str(r["token"]))
            tried.add(key)
            if not r.get("ok") or r.get("jobs_israel", 0) < 1:
                if r.get("ok") and r.get("jobs_total", 0) > 0:
                    exists_no_il.add(key)
                else:
                    failed.add(key)
                continue
            if key in seen_pairs or key in BLOCK_TOKENS:
                continue
            seen_pairs.add(key)
            hits.append({
                "name": (r.get("name") or r.get("board_name") or "").strip(),
                "domain": nd(r.get("domain")),
                "provider": r["provider"],
                "token": str(r["token"]),
                "jobs_total": r["jobs_total"],
                "jobs_israel": r["jobs_israel"],
                "source": "curated" if r.get("name") else "search-enumeration",
            })
        else:
            if r.get("jobs_israel", 0) < 1:
                continue
            key = ("comeet", f"{r['uid']}::{r['token']}")
            if key in seen_pairs or ("comeet", r["uid"]) in BLOCK_TOKENS:
                continue
            seen_pairs.add(key)
            hits.append({
                "name": (r.get("name") or r.get("slug") or "").strip(),
                "domain": nd(r.get("domain")),
                "provider": "comeet",
                "token": key[1],
                "jobs_total": r["jobs_total"],
                "jobs_israel": r["jobs_israel"],
                "source": "comeet-careers-page",
                "careers_url": r.get("careers_url", ""),
            })

    for h in hits:
        if not h["domain"]:
            h["domain"] = name_map.get(norm_name(h["name"]), "")
    asyncio.run(resolve(hits))

    best: dict[str, dict] = {}
    dropped_no_domain = 0
    for h in hits:
        d = nd(h["domain"])
        if not d or d in BLOCK_DOMAINS:
            dropped_no_domain += 1
            continue
        h["domain"] = d
        cur = best.get(d)
        if cur is None:
            h["sources"] = {h["source"], "verified"}
            best[d] = h
        elif (h["jobs_israel"], h["jobs_total"]) > (cur["jobs_israel"],
                                                    cur["jobs_total"]):
            h["sources"] = set(cur.get("sources", ())) | {h["source"], "verified"}
            best[d] = h
        else:
            cur["sources"] = set(cur.get("sources", ())) | {h["source"]}

    out = []
    for d, h in best.items():
        p, t = h["provider"], h["token"]
        out.append({
            "name": h["name"] or d.split(".")[0].replace("-", " ").title(),
            "domain": d,
            "ats_provider": p,
            "ats_token": t,
            "ats_feed_url": feed_url(p, t),
            "ats_confidence": 1.0,
            "careers_url": h.get("careers_url") or careers_url(p, t, d)
                           or f"https://{d}/careers",
            "jobs_total": h["jobs_total"],
            "jobs_israel": h["jobs_israel"],
            "sources": sorted(h.get("sources", {"verified"})),
        })
    out.sort(key=lambda x: (-x["jobs_israel"], -x["jobs_total"], x["name"]))

    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    by_prov = Counter(e["ats_provider"] for e in out)
    jt = sum(e["jobs_total"] for e in out)
    ji = sum(e["jobs_israel"] for e in out)
    failed = {k for k in failed if k not in {(e["ats_provider"], e["ats_token"])
                                             for e in out}}
    fail_by_prov: dict[str, list[str]] = defaultdict(list)
    for p, t in sorted(failed):
        fail_by_prov[p].append(t)

    L = [
        "# Jobsworm — ATS seed verification report", "",
        f"**Verified companies:** {len(out)}  ",
        f"**Open jobs across their boards:** {jt:,}  ",
        f"**Jobs located in Israel:** {ji:,}  ",
        "",
        "Every row was confirmed by a live HTTP call to the provider's public, "
        "unauthenticated job-board JSON API that returned at least one job "
        "whose location matches an Israeli city or the country name "
        "(English or Hebrew). `ats_confidence` is 1.0 for all rows because the "
        "feed itself returned jobs (PLAN.md 4.2).",
        "",
        "## Breakdown by ATS provider", "",
        "| provider | companies | jobs total | jobs in Israel |",
        "|---|---:|---:|---:|",
    ]
    for p, n in by_prov.most_common():
        L.append(f"| {p} | {n} | "
                 f"{sum(e['jobs_total'] for e in out if e['ats_provider']==p):,} | "
                 f"{sum(e['jobs_israel'] for e in out if e['ats_provider']==p):,} |")
    L += ["", "## Top 30 companies by Israeli job count", "",
          "| # | company | domain | ATS | jobs (IL) | jobs (total) |",
          "|---:|---|---|---|---:|---:|"]
    for i, e in enumerate(out[:30], 1):
        L.append(f"| {i} | {e['name']} | {e['domain']} | {e['ats_provider']} | "
                 f"{e['jobs_israel']} | {e['jobs_total']} |")

    L += ["", "## Coverage of the attempt", "",
          f"- (provider, token) pairs tested: **{len(tried):,}**",
          f"- pairs that returned a live board: "
          f"**{len(tried) - len(failed):,}**",
          f"- boards that exist but currently list **no** Israeli job: "
          f"**{len(exists_no_il):,}** (worth re-checking later — hiring "
          f"resumes)",
          f"- hits dropped because no company domain could be resolved: "
          f"**{dropped_no_domain}**",
          "",
          "## Failed candidate tokens (retry in a later session)", "",
          "These were tried and returned 404 or an empty/non-existent board. Kept so a future run "
          "does not repeat them, and so a human can spot ones that are simply "
          "spelled differently.", ""]
    for p in sorted(fail_by_prov):
        toks = fail_by_prov[p]
        L.append(f"<details><summary><b>{p}</b> — {len(toks):,} failed "
                 f"tokens</summary>\n")
        L.append("```")
        for i in range(0, len(toks), 12):
            L.append(" ".join(toks[i:i + 12]))
        L.append("```")
        L.append("</details>\n")

    with open(a.report, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")

    print(f"companies: {len(out)}  jobs_total: {jt}  jobs_israel: {ji}")
    print(by_prov.most_common())
    return 0


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    raise SystemExit(main())
