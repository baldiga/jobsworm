#!/usr/bin/env python3
"""
qa_identity.py — confirm that a brute-forced ATS token really belongs to the
company we attributed it to, and correct the name when the board says otherwise.

Why: tokens are generated from company names, so "Memic" can find a Greenhouse
board that actually belongs to a US insurer of the same name. Several providers
expose the board owner's real name; we use it as the authority.

  greenhouse       GET /v1/boards/{token}            -> {"name": ...}
  workable         GET /api/v1/widget/accounts/{t}   -> {"name": ...}
  recruitee        GET /api/offers/                  -> offers[].company_name
  smartrecruiters  GET /v1/companies/{token}         -> {"name": ...}
  comeet           positions[].company_name          (already applied)
  lever / ashby    no board-owner name in the public API -> left as-is

Writes the corrected file in place and prints every correction.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import unicodedata
from difflib import SequenceMatcher

import httpx

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
H = {"User-Agent": UA, "Accept": "application/json"}


def key(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\b(ltd|inc|corp|limited|llc|plc|gmbh|the|technologies|"
               r"technology|group|holdings|software|systems|labs?|company|"
               r"israel|com)\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


async def owner_name(client: httpx.AsyncClient, e: dict) -> str | None:
    p, t = e["ats_provider"], e["ats_token"]
    try:
        if p == "greenhouse":
            r = await client.get(
                f"https://boards-api.greenhouse.io/v1/boards/{t}",
                headers=H, timeout=20)
            return (r.json() or {}).get("name") if r.status_code == 200 else None
        if p == "workable":
            r = await client.get(
                f"https://apply.workable.com/api/v1/widget/accounts/{t}",
                headers=H, timeout=20)
            return (r.json() or {}).get("name") if r.status_code == 200 else None
        if p == "smartrecruiters":
            r = await client.get(
                f"https://api.smartrecruiters.com/v1/companies/{t}",
                headers=H, timeout=20)
            return (r.json() or {}).get("name") if r.status_code == 200 else None
        if p == "recruitee":
            r = await client.get(f"https://{t}.recruitee.com/api/offers/",
                                 headers=H, timeout=20)
            if r.status_code == 200:
                offers = (r.json() or {}).get("offers") or []
                for o in offers:
                    if o.get("company_name"):
                        return o["company_name"]
    except Exception:  # noqa: BLE001
        return None
    return None


async def run(path: str, conc: int) -> None:
    data = json.load(open(path, encoding="utf-8"))
    sem = asyncio.Semaphore(conc)
    fixes: list[tuple[str, str, str]] = []

    async def one(client: httpx.AsyncClient, e: dict) -> None:
        async with sem:
            n = await owner_name(client, e)
        if not n:
            return
        a, b = key(e["name"]), key(n)
        if not a or not b:
            return
        sim = SequenceMatcher(None, a, b).ratio()
        if a in b or b in a or sim >= 0.72:
            return
        fixes.append((e["ats_provider"] + ":" + e["ats_token"], e["name"], n))
        e["name"] = n
        e["identity_note"] = (
            f"name taken from the {e['ats_provider']} board owner; the "
            f"candidate name that found this token was different")

    async with httpx.AsyncClient(verify=False) as client:
        await asyncio.gather(*(one(client, e) for e in data))

    json.dump(data, open(path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"checked {len(data)} rows; corrected {len(fixes)} names")
    for tok, was, now in fixes:
        print(f"  {tok}: '{was}' -> '{now}'")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--conc", type=int, default=8)
    a = ap.parse_args()
    asyncio.run(run(a.path, a.conc))
    return 0


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    raise SystemExit(main())
