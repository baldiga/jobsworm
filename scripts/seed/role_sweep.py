#!/usr/bin/env python3
"""Sweep the permitted sources for open roles in one job family.

Only the sources docs/data-sources-and-legal.md marks as shipping: the
employers' own ATS feeds, RevHub's static JSON, and Workable's public board
(which carries `Content-Signal: search=yes`). Nothing withheld, nothing behind
a login. See docs/handover-job-digest.md before changing the source list.

    python scripts/seed/role_sweep.py --family gtm --days 30 --verify
    python scripts/seed/role_sweep.py --pattern "data\\s*engineer|analytics" --days 14

Writes <out>/role_sweep.json and prints a table. The JSON carries the full
description text for each hit, which is what you write the digest from.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime
import json
import os
import re
import sys

import httpx

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
UA = {"User-Agent": "JobswormBot/1.0 (+https://github.com/baldiga/jobsworm)"}

# ---------------------------------------------------------------- role families
# Add a family here rather than editing the regex at the call site, so the next
# person gets the same exclusions for free.
FAMILIES = {
    # GTM engineering and the revenue-operations roles beside it. Deliberately
    # not plain "Sales" or "Marketing Manager".
    "gtm": (
        r"gtm\s*engineer|go.to.market\s*engineer|growth\s*engineer|"
        r"rev\s*ops|revenue\s*operations|revenue\s*ops|"
        r"sales\s*operations|sales\s*ops|marketing\s*operations|marketing\s*ops|"
        r"growth\s*operations|growth\s*ops|business\s*operations|biz\s*ops|"
        r"gtm\s*(?:lead|manager|analyst|strategy|systems)|"
        r"demand\s*gen|demand\s*generation|"
        r"salesforce|hubspot|crm\s*(?:admin|manager|operations|ops|architect)|"
        r"sales\s*enablement|revenue\s*enablement|"
        r"growth\s*(?:marketer|marketing\s*manager|lead)|"
        r"lifecycle\s*marketing|marketing\s*automation|"
        r"solutions?\s*engineer|sales\s*engineer|pre.?sales\s*engineer|"
        r"partnerships?\s*manager|channel\s*(?:sales|partnerships?)"
    ),
    "data": (
        r"data\s*engineer|analytics\s*engineer|data\s*analyst|data\s*scientist|"
        r"machine\s*learning|ml\s*engineer|bi\s*(?:developer|analyst)|data\s*platform"
    ),
    "product": r"product\s*manager|product\s*owner|product\s*lead|group\s*product|technical\s*product",
    "finance": r"controller|cfo|financial\s*analyst|fp&a|bookkeep|accountant|revenue\s*accounting|tax\s*manager",
}

# Titles the family regex would otherwise drag in. "Sales Engineer" is wanted;
# "Software Engineer" is not, and both match a bare \bengineer\b.
SKIP = re.compile(
    r"\b(software|backend|front.?end|full.?stack|data|platform|devops|qa|security)\s+engineer\b", re.I
)

IL = re.compile(
    r"israel|ישראל|tel[\s-]?aviv|תל[\s-]?אביב|herzliya|הרצליה|ramat[\s-]?gan|רמת[\s-]?גן|"
    r"haifa|חיפה|jerusalem|ירושלים|netanya|נתניה|raanana|ra'anana|רעננה|petah|פתח[\s-]?תקווה|"
    r"rehovot|רחובות|beer[\s-]?sheva|באר[\s-]?שבע|yokneam|יקנעם|caesarea|קיסריה|ness\s*ziona|"
    r"hod hasharon|kfar saba|givatayim|holon|rishon|modiin|מודיעין",
    re.I,
)


def parse_dt(v):
    """Return an aware UTC datetime, or None. Handles Lever's millisecond ints."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        s = float(v) / 1000 if float(v) > 1e11 else float(v)
        try:
            return datetime.datetime.fromtimestamp(s, datetime.timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    s = str(v).strip().replace("Z", "+00:00")
    for fmt in (None, "%Y-%m-%d", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            d = datetime.datetime.fromisoformat(s) if fmt is None else datetime.datetime.strptime(s, fmt)
            return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            continue
    return None


def clean(html: str, limit: int = 2600) -> str:
    """HTML to readable text. Bullets survive as '• ' because the responsibilities
    list is usually the only part of a posting worth quoting."""
    if not html:
        return ""
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    t = re.sub(r"<li[^>]*>", "\n• ", t, flags=re.I)
    t = re.sub(r"<(br|/p|/div|/h\d)[^>]*>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    for a, b in (
        ("&nbsp;", " "), ("&amp;", "&"), ("&quot;", '"'), ("&#39;", "'"), ("&lt;", "<"),
        ("&gt;", ">"), ("&rsquo;", "'"), ("&ldquo;", '"'), ("&rdquo;", '"'), ("&#xa0;", " "),
    ):
        t = t.replace(a, b)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t)
    return t.strip()[:limit]


def fetch(client, url, **kw):
    r = client.get(url, timeout=25, headers=UA, follow_redirects=True, **kw)
    r.raise_for_status()
    return r


# ---------------------------------------------------------------- ATS providers
def greenhouse(c, co, want):
    out = []
    r = fetch(c, f"https://boards-api.greenhouse.io/v1/boards/{co['ats_token']}/jobs?content=true")
    for j in r.json().get("jobs", []):
        loc = (j.get("location") or {}).get("name", "")
        if not hit(j.get("title"), loc, want):
            continue
        out.append(dict(
            title=j["title"], company=co["name"], location=loc,
            posted=j.get("first_published") or j.get("updated_at"),
            url=j.get("absolute_url"), body=clean(j.get("content", "")), provider="greenhouse"))
    return out


def lever(c, co, want):
    out = []
    r = fetch(c, f"https://api.lever.co/v0/postings/{co['ats_token']}?mode=json")
    for j in r.json():
        loc = (j.get("categories") or {}).get("location", "")
        if not hit(j.get("text"), loc, want):
            continue
        out.append(dict(
            title=j["text"], company=co["name"], location=loc, posted=j.get("createdAt"),
            url=j.get("hostedUrl"), body=clean(j.get("descriptionPlain") or j.get("description", "")),
            provider="lever"))
    return out


def ashby(c, co, want):
    out = []
    r = fetch(c, f"https://api.ashbyhq.com/posting-api/job-board/{co['ats_token']}?includeCompensation=true")
    for j in r.json().get("jobs", []):
        loc = j.get("location") or ""
        if not hit(j.get("title"), loc, want):
            continue
        out.append(dict(
            title=j["title"], company=co["name"], location=loc,
            posted=j.get("publishedAt") or j.get("updatedAt"),
            url=j.get("jobUrl") or j.get("applyUrl"),
            body=clean(j.get("descriptionHtml") or j.get("descriptionPlain", "")), provider="ashby"))
    return out


def smartrecruiters(c, co, want):
    """The postings list carries no description. Each hit needs a second call to
    /postings/{id}, so only the hits pay for it."""
    out = []
    r = fetch(c, f"https://api.smartrecruiters.com/v1/companies/{co['ats_token']}/postings?limit=100")
    for j in r.json().get("content", []):
        lo = j.get("location") or {}
        loc = ", ".join(x for x in (lo.get("city"), lo.get("country")) if x)
        if not hit(j.get("name"), loc, want):
            continue
        body = ""
        try:
            d = fetch(c, f"https://api.smartrecruiters.com/v1/companies/{co['ats_token']}/postings/{j['id']}").json()
            sec = d.get("jobAd", {}).get("sections", {})
            body = clean(" ".join(
                (sec.get(k) or {}).get("text", "") for k in ("jobDescription", "qualifications")))
        except Exception:
            pass
        out.append(dict(
            title=j["name"], company=co["name"], location=loc,
            posted=j.get("releasedDate") or j.get("createdOn"),
            url=j.get("applyUrl") or f"https://jobs.smartrecruiters.com/{co['ats_token']}/{j.get('id')}",
            body=body, provider="smartrecruiters"))
    return out


def recruitee(c, co, want):
    out = []
    r = fetch(c, f"https://{co['ats_token']}.recruitee.com/api/offers/")
    for j in r.json().get("offers", []):
        loc = ", ".join(x for x in (j.get("city"), j.get("country")) if x)
        if not hit(j.get("title"), loc, want):
            continue
        out.append(dict(
            title=j["title"], company=co["name"], location=loc,
            posted=j.get("published_at") or j.get("created_at"),
            url=j.get("careers_url") or j.get("url"),
            body=clean(j.get("description", "")), provider="recruitee"))
    return out


def comeet(c, co, want):
    out = []
    tok = co.get("ats_token") or ""
    if "::" not in tok:
        return out
    uid, t = tok.split("::", 1)
    r = fetch(c, f"https://www.comeet.co/careers-api/2.0/company/{uid}/positions?token={t}&details=true")
    for j in r.json():
        raw = j.get("location")
        loc = raw.get("name", "") if isinstance(raw, dict) else str(raw or "")
        if not hit(j.get("name"), loc, want):
            continue
        det = j.get("details") or []
        # `or ""` matters: several boards return a null value for a detail block,
        # and join() raises on None rather than skipping it. Six boards were
        # silently failing before this guard.
        body = clean(" ".join((d.get("value") or "") for d in det if isinstance(d, dict)))
        # Comeet publishes no creation date, only time_updated, which moves
        # whenever the listing is edited. Flagged so nothing downstream reports
        # it as a publish date.
        out.append(dict(
            title=j["name"], company=co["name"], location=loc,
            posted=j.get("time_updated"), date_is_update_only=True,
            url=j.get("url_comeet_hosted_page") or j.get("url_active_page"),
            email=j.get("email") or j.get("email_alias"),
            employment=j.get("employment_type"), seniority=j.get("experience_level"),
            dept=j.get("department"), body=body, provider="comeet"))
    return out


PROVIDERS = {
    "greenhouse": greenhouse, "lever": lever, "ashby": ashby,
    "smartrecruiters": smartrecruiters, "recruitee": recruitee, "comeet": comeet,
}


def hit(title, loc, want):
    """Title must match the family; location must look Israeli or be blank.

    Blank counts as a hit on purpose: Israeli boards often leave location empty
    because the whole company sits here. The cost is a few foreign roles to drop
    by hand, which is cheaper than missing real ones."""
    if not title or SKIP.search(title) or not want.search(title):
        return False
    return (not (loc or "").strip()) or bool(IL.search(loc))


def one(args):
    co, want = args
    fn = PROVIDERS.get(co.get("ats_provider") or "")
    if not fn or not co.get("ats_token"):
        return []
    try:
        with httpx.Client() as c:
            return fn(c, co, want)
    except Exception as e:
        return [{"_error": f"{co['name']} ({co.get('ats_provider')}): {type(e).__name__} {e}"}]


def verify_links(jobs):
    """A posting pulled from a cached feed can already be closed. Never publish
    a link this has not returned 200 for."""
    def check(j):
        try:
            with httpx.Client() as c:
                r = c.get(j["url"], timeout=25, headers=UA, follow_redirects=True)
            j["http"] = r.status_code
        except Exception as e:
            j["http"] = f"ERR {type(e).__name__}"
        return j
    with cf.ThreadPoolExecutor(8) as ex:
        return list(ex.map(check, jobs))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--family", choices=sorted(FAMILIES), default="gtm")
    p.add_argument("--pattern", help="Custom title regex. Overrides --family.")
    p.add_argument("--days", type=int, default=30, help="Freshness window (default 30).")
    p.add_argument("--workers", type=int, default=10, help="Parallel boards (default 10; be kind).")
    p.add_argument("--verify", action="store_true", help="HTTP-check every fresh link.")
    p.add_argument("--out", default=os.path.join(ROOT, "data", "role_sweep.json"))
    a = p.parse_args()

    want = re.compile(r"\b(" + (a.pattern or FAMILIES[a.family]) + r")\b", re.I)
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(days=a.days)

    seed = os.path.join(ROOT, "data", "companies.seed.json")
    comps = [c for c in json.load(open(seed, encoding="utf-8"))
             if c.get("ats_provider") in PROVIDERS and c.get("ats_token")]
    print(f"probing {len(comps)} employer boards for '{a.pattern or a.family}'...", flush=True)

    jobs, errors = [], []
    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        for i, res in enumerate(ex.map(one, ((c, want) for c in comps)), 1):
            for r in res:
                (errors if "_error" in r else jobs).append(r.get("_error") or r)
            if i % 50 == 0:
                print(f"  {i}/{len(comps)}  hits so far: {len(jobs)}", flush=True)

    # Workable's public board. Caps at 20 rows with no offset, so partition the
    # query space by role word rather than asking for everything at once.
    try:
        with httpx.Client() as c:
            for q in (a.pattern or a.family).split("|")[:10]:
                q = re.sub(r"[\\\\()?:\[\]+*]|\\s\*", " ", q).strip()
                if len(q) < 3:
                    continue
                try:
                    r = fetch(c, "https://jobs.workable.com/api/v1/jobs",
                              params={"query": q, "location": "Israel", "limit": 20})
                    for j in r.json().get("jobs", []):
                        loc = ", ".join(x for x in (j.get("city"), j.get("country")) if x)
                        if not hit(j.get("title"), loc, want):
                            continue
                        comp = j.get("company")
                        jobs.append(dict(
                            title=j["title"],
                            company=comp.get("title") if isinstance(comp, dict) else comp,
                            location=loc, posted=j.get("published_on") or j.get("created_at"),
                            url=j.get("url") or j.get("shortlink"),
                            body=clean(j.get("description", "")), provider="workable"))
                except Exception as e:
                    errors.append(f"workable[{q}]: {type(e).__name__} {e}")
    except Exception as e:
        errors.append(f"workable: {type(e).__name__} {e}")

    fresh, undated, old = [], [], 0
    for j in jobs:
        d = parse_dt(j.get("posted"))
        j["posted_iso"] = d.isoformat() if d else None
        j["age_days"] = (now - d).days if d else None
        if d is None:
            undated.append(j)
        elif d >= cutoff:
            fresh.append(j)
        else:
            old += 1
    fresh.sort(key=lambda x: x["age_days"])

    if a.verify and fresh:
        print(f"verifying {len(fresh)} links...", flush=True)
        fresh = verify_links(fresh)

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump({"generated": now.isoformat(), "family": a.pattern or a.family, "days": a.days,
               "fresh": fresh, "undated": undated, "errors": errors,
               "counts": {"matched": len(jobs), "fresh": len(fresh), "undated": len(undated),
                          "too_old": old, "errors": len(errors)}},
              open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print(f"\nmatched {len(jobs)} | fresh (<={a.days}d) {len(fresh)} | undated {len(undated)} | "
          f"too old {old} | board errors {len(errors)}")
    if errors:
        print("\nBOARD ERRORS (investigate; a parser bug hides real jobs):")
        for e in errors[:20]:
            print("  ", e)
    print()
    for j in fresh:
        flag = "~" if j.get("date_is_update_only") else " "
        code = f" [{j['http']}]" if "http" in j else ""
        print(f"  {j['age_days']:>3}d{flag} {str(j['company'])[:24]:<24} {j['title'][:56]:<56} "
              f"{j['provider']}{code}")
    print("\n  ~ = Comeet, date is last-updated and NOT a publish date")
    print("wrote", a.out)


if __name__ == "__main__":
    main()
