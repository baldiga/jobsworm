#!/usr/bin/env python3
"""
build_seed.py — merge every verification run into data/companies.seed.json
and data/seed-report.md.

Inputs
  data/_seed_work/tried.jsonl     every (provider, token) pair ever tested
  data/_seed_work/comeet*.json    comeet_discover.py output
  data/_seed_work/*.json          verify_ats.py round outputs (optional)

Rules
  * keep an entry only if the feed returned >= 1 job AND >= 1 job has an
    Israeli-looking location
  * dedupe by domain, keeping the board with the most Israeli jobs
  * sort by jobs_israel desc
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_ats import PROVIDERS, careers_url, feed_url  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = os.path.join(ROOT, "data", "_seed_work")
DATA = os.path.join(ROOT, "data")


def load_names() -> dict[str, tuple[str, str]]:
    """token-free lookup: normalized name -> (display name, domain)."""
    out: dict[str, tuple[str, str]] = {}
    for fn in os.listdir(os.path.join(ROOT, "scripts", "seed")):
        if not fn.startswith("companies_candidates"):
            continue
        for line in open(os.path.join(ROOT, "scripts", "seed", fn),
                         encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            p = [x.strip() for x in line.split("|")]
            if len(p) > 1 and p[1]:
                out.setdefault(p[0].lower(), (p[0], p[1].lower()))
    return out


def norm_domain(d: str | None) -> str | None:
    if not d:
        return None
    d = d.strip().lower()
    d = re.sub(r"^https?://", "", d)
    d = re.sub(r"^www\.", "", d)
    d = d.split("/")[0].strip()
    return d or None


def main() -> int:
    entries: list[dict] = []
    tried: list[dict] = []

    # --- brute-force results -------------------------------------------
    jsonl = os.path.join(WORK, "tried.jsonl")
    if os.path.exists(jsonl):
        for line in open(jsonl, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            tried.append(r)
            if not r.get("ok") or r.get("jobs_israel", 0) < 1:
                continue
            dom = norm_domain(r.get("domain"))
            if not dom:
                continue
            entries.append({
                "name": r.get("name") or r["token"],
                "domain": dom,
                "ats_provider": r["provider"],
                "ats_token": r["token"],
                "ats_feed_url": feed_url(r["provider"], r["token"]),
                "ats_confidence": 1.0,
                "careers_url": careers_url(r["provider"], r["token"], dom),
                "jobs_total": r["jobs_total"],
                "jobs_israel": r["jobs_israel"],
                "sources": ["curated", "ats-token-bruteforce", "verified"],
            })

    # --- explicit (provider, token) results kept in extra_results.json --
    extra = os.path.join(WORK, "extra_results.json")
    if os.path.exists(extra):
        for r in json.load(open(extra, encoding="utf-8")):
            if not r.get("ok") or r.get("jobs_israel", 0) < 1:
                continue
            dom = norm_domain(r.get("domain"))
            if not dom:
                continue
            entries.append({
                "name": r.get("name") or r["token"],
                "domain": dom,
                "ats_provider": r["provider"],
                "ats_token": r["token"],
                "ats_feed_url": feed_url(r["provider"], r["token"]),
                "ats_confidence": 1.0,
                "careers_url": careers_url(r["provider"], r["token"], dom),
                "jobs_total": r["jobs_total"],
                "jobs_israel": r["jobs_israel"],
                "sources": ["curated", "search-enumeration", "verified"],
            })

    # --- careers-page ATS detection (detect_ats.py) ---------------------
    det = os.path.join(WORK, "detected.json")
    if os.path.exists(det):
        for r in json.load(open(det, encoding="utf-8")):
            if r.get("jobs_israel", 0) < 1:
                continue
            dom = norm_domain(r.get("domain"))
            if not dom:
                continue
            entries.append({
                "name": r.get("name") or dom,
                "domain": dom,
                "ats_provider": r["provider"],
                "ats_token": r["token"],
                "ats_feed_url": feed_url(r["provider"], r["token"]),
                "ats_confidence": 1.0,
                "careers_url": r.get("careers_url") or f"https://{dom}/careers",
                "jobs_total": r["jobs_total"],
                "jobs_israel": r["jobs_israel"],
                "sources": ["curated", "careers-page-detection", "verified"],
            })

    # --- comeet discovery ----------------------------------------------
    for fn in sorted(os.listdir(WORK)):
        if not (fn.startswith("comeet") and fn.endswith(".json")):
            continue
        for r in json.load(open(os.path.join(WORK, fn), encoding="utf-8")):
            if r.get("jobs_israel", 0) < 1:
                continue
            dom = norm_domain(r.get("domain"))
            if not dom:
                continue
            token = f"{r['uid']}::{r['token']}"
            entries.append({
                "name": r.get("name") or dom,
                "domain": dom,
                "ats_provider": "comeet",
                "ats_token": token,
                "ats_feed_url": feed_url("comeet", token),
                "ats_confidence": 1.0,
                "careers_url": r.get("careers_url") or f"https://{dom}/careers",
                "jobs_total": r["jobs_total"],
                "jobs_israel": r["jobs_israel"],
                "sources": ["curated", "comeet-careers-page", "verified"],
            })

    # --- dedupe by domain, best board wins -----------------------------
    best: dict[str, dict] = {}
    for e in entries:
        cur = best.get(e["domain"])
        if cur is None or (e["jobs_israel"], e["jobs_total"]) > \
                (cur["jobs_israel"], cur["jobs_total"]):
            if cur:
                e["sources"] = sorted(set(e["sources"]) | set(cur["sources"]))
            best[e["domain"]] = e
        else:
            cur["sources"] = sorted(set(cur["sources"]) | set(e["sources"]))

    out = sorted(best.values(), key=lambda x: (-x["jobs_israel"],
                                               -x["jobs_total"], x["domain"]))
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "companies.seed.json"), "w",
              encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # --- report ---------------------------------------------------------
    by_prov = Counter(e["ats_provider"] for e in out)
    jobs_total = sum(e["jobs_total"] for e in out)
    jobs_il = sum(e["jobs_israel"] for e in out)

    failed: dict[str, list[str]] = defaultdict(list)
    ok_pairs = {(e["ats_provider"], e["ats_token"]) for e in out}
    for r in tried:
        if (r["provider"], r["token"]) in ok_pairs:
            continue
        if r.get("ok") and r.get("jobs_total", 0) > 0:
            continue  # board exists, just no Israeli jobs — listed separately
        failed[r["provider"]].append(r["token"])

    no_il = [r for r in tried
             if r.get("ok") and r.get("jobs_total", 0) > 0
             and r.get("jobs_israel", 0) == 0]

    lines: list[str] = []
    lines.append("# Jobsworm — ATS seed verification report\n")
    lines.append(f"**Verified companies:** {len(out)}  ")
    lines.append(f"**Total open jobs across all boards:** {jobs_total:,}  ")
    lines.append(f"**Jobs with an Israeli location:** {jobs_il:,}\n")
    lines.append("Every row below was confirmed by a live HTTP call to the "
                 "provider's public job-board JSON API that returned at least "
                 "one job whose location string matches an Israeli city or "
                 "the country name (English or Hebrew).\n")

    lines.append("## Breakdown by provider\n")
    lines.append("| provider | companies | jobs total | jobs in Israel |")
    lines.append("|---|---:|---:|---:|")
    for p, n in by_prov.most_common():
        lines.append(f"| {p} | {n} | "
                     f"{sum(e['jobs_total'] for e in out if e['ats_provider']==p):,} | "
                     f"{sum(e['jobs_israel'] for e in out if e['ats_provider']==p):,} |")
    lines.append("")

    lines.append("## Top 30 companies by Israeli job count\n")
    lines.append("| # | company | domain | provider | jobs in Israel | jobs total |")
    lines.append("|---:|---|---|---|---:|---:|")
    for i, e in enumerate(out[:30], 1):
        lines.append(f"| {i} | {e['name']} | {e['domain']} | "
                     f"{e['ats_provider']} | {e['jobs_israel']} | "
                     f"{e['jobs_total']} |")
    lines.append("")

    lines.append("## Boards that exist but currently list no Israeli job\n")
    lines.append("Worth re-checking on a later run — several are token "
                 "collisions with a same-named non-Israeli company, the rest "
                 "simply have no open Israeli role right now.\n")
    lines.append("| provider | token | jobs |")
    lines.append("|---|---|---:|")
    for r in sorted(no_il, key=lambda x: -x["jobs_total"])[:120]:
        lines.append(f"| {r['provider']} | `{r['token']}` | {r['jobs_total']} |")
    lines.append("")

    lines.append("## Candidate tokens tried that returned nothing\n")
    lines.append(f"{sum(len(v) for v in failed.values()):,} "
                 f"(provider, token) pairs. A later session can retry these "
                 f"with new token variants.\n")
    for p in sorted(failed):
        toks = sorted(set(failed[p]))
        lines.append(f"<details><summary><b>{p}</b> — {len(toks)} tokens"
                     f"</summary>\n")
        lines.append("```")
        for i in range(0, len(toks), 12):
            lines.append(" ".join(toks[i:i + 12]))
        lines.append("```")
        lines.append("</details>\n")

    with open(os.path.join(DATA, "seed-report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"companies: {len(out)}  jobs_total: {jobs_total}  "
          f"jobs_israel: {jobs_il}")
    print(dict(by_prov))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
