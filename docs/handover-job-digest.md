# Handover: building a job digest from Jobsworm's sources

You have been asked to sweep Jobsworm's sources for open roles in some family
(GTM engineers, RevOps, data engineers, whatever was named) and turn the result
into a short Hebrew message for a WhatsApp group.

This document is the whole job. Read section 1 before you touch a network call.

---

## 1. The permission boundary — read this first

Jobsworm's entire legal position rests on one rule: **read the terms, not the
robots.txt.** A permissive `robots.txt` is not permission. That rule exists
because jobmaster.co.il serves `Allow: /` while its תקנון forbids any commercial
use of its listings.

### Sources you may use

| Source | Why it is allowed |
|---|---|
| Employer ATS feeds (Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Comeet) | The employer publishes these so their own careers page can render. Calling them directly is the intended use. |
| Workable public board (`jobs.workable.com/api/v1/jobs`) | Its robots.txt carries `Content-Signal: search=yes`, an express grant to index with links and short excerpts. |
| RevHub (`jobs.revhub.club/jobs.json`) | A small curated feed published as static JSON. **Currently stale, see §4.4.** |

### Sources you may not use, whatever the reason sounds like

AllJobs · Drushim · Yad2 · Secret Tel Aviv · JobMaster · TechJob · TheJob ·
Janglo · LinkedIn (including data bought from an aggregator — their User
Agreement names third-party brokers explicitly) · Glassdoor · Indeed ·
Getro- and Consider-hosted VC boards · any Facebook group that is not confirmed
public · any WhatsApp group · any Telegram channel without the owner adding a
bot as admin.

`packages/adapters/src/import-scraped.ts` enforces the first five in code. The
rest are in `docs/data-sources-and-legal.md` with the specific clause for each.

**If you are tempted to add a source:** stop and read its terms first, and write
down the clause that permits what you want to do. "It was easy to fetch" is not the
test. Being able to is not permission to.

### The one that will tempt you

The task is "find jobs." LinkedIn has all the jobs. LinkedIn is banned, and that
ban includes a CSV someone hands you, a vendor API, and a search tool the
project already pays for. Company **names** scraped from such a list may be used
as a hint to go find that company's own ATS board. Listing **content** may not.

---

## 2. Run the sweep

```bash
python scripts/seed/role_sweep.py --family gtm --days 30 --verify
```

Flags: `--family` (gtm | data | product | finance), `--pattern` for a custom
title regex, `--days` for the freshness window, `--verify` to HTTP-check every
link, `--out` for the JSON path.

It probes all ~289 employer boards in `data/companies.seed.json`, plus Workable,
in 10 parallel threads. Takes about 2 minutes. Writes
`data/role_sweep.json` with the full description text for every hit, and prints
a table.

This touches no database and writes nothing to Supabase, so the usual pacing
rule for that CPU-starved instance does not apply here. Do not raise
`--workers` much above 10 anyway; these are other people's servers.

**Adding a role family:** edit `FAMILIES` in the script rather than passing a
long `--pattern`, so the next person inherits the same `SKIP` exclusions.

---

## 3. Read the error list before you read the results

```
board errors 0
```

That line matters more than the hit count. A non-zero value means some boards
threw, and **a parser bug hides real jobs silently** — the sweep still prints a
confident-looking table while N companies contributed nothing.

This happened: six Comeet boards (Automat-it, Cognyte, Deepdub, Guardio, Pango,
ScaleOps) were crashing on `TypeError: sequence item 1: expected str instance,
NoneType found`, because Comeet returns a null `value` for some detail blocks
and `join()` raises on None rather than skipping it. Two jobs that belonged in
the final digest were in those boards. The guard is `(d.get("value") or "")`.

Never report a result set without first accounting for every error.

---

## 4. The traps

### 4.1 Comeet has no publish date

Comeet exposes `time_updated` and nothing else. It moves whenever anyone edits
the listing. About 60% of the Israeli boards in the seed file are Comeet, so
most of your rows have **no publish date at all**.

The script flags these with `date_is_update_only: true` and a `~` in the table.

You may write "פורסמו או עודכנו בחודש האחרון". You may not write "פורסמו
בחודש האחרון" for a Comeet row. The distinction is small and it is still a
false claim if you get it wrong.

Real publish dates, by provider:

| Provider | Field | Trustworthy? |
|---|---|---|
| Greenhouse | `first_published` | yes |
| Lever | `createdAt` (ms epoch) | yes |
| Ashby | `publishedAt` | yes |
| SmartRecruiters | `releasedDate` | yes |
| Recruitee | `published_at` | yes |
| Comeet | `time_updated` | **no — last edit only** |

### 4.2 A 403 does not mean the job is closed

`--verify` HTTP-checks each link. Treat the codes like this:

- **200** — good, publish it.
- **404 / 410** — gone. Drop it.
- **403 / 405 / 429** — **inconclusive.** Many careers pages sit behind a WAF
  that blocks any server-side request, including one with a browser User-Agent.

Riskified is the worked example: `www.riskified.com/careers/...` returns 403 to
both a bot UA and a Chrome UA, while
`boards-api.greenhouse.io/v1/boards/riskified/jobs/{id}` returns 200 with the
live title. The job is open; the website just refuses robots.

**Resolve a 403 by re-querying the ATS API for that job id**, not by guessing:

```
https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{gh_jid}
https://api.lever.co/v0/postings/{token}/{id}
https://api.smartrecruiters.com/v1/companies/{token}/postings/{id}
```

If the ATS confirms it, publish the link. If you cannot confirm it either way,
drop the job. Never ship an unverified link to a group of job seekers.

### 4.3 SmartRecruiters needs a second call

`/postings?limit=100` returns titles with **no description**. The body lives at
`/postings/{id}` under `jobAd.sections.jobDescription` and `.qualifications`.
The script already does this, but only for hits, to keep the call count down.

### 4.4 RevHub is stale

`jobs.revhub.club/jobs.json` is the only curated GTM-specific feed, so it looks
like the obvious first stop. As of 2026-10-16 its `generated_at` reads
`2026-08-13` and the newest posting on it is 68 days old. Nothing on it passes a
30-day filter.

Its key names also differ from every other source: the link is `contact.url`
(not `url`), the text is `summary` (not `description`), and `location` is
usually null. If you reinstate it, parse it on its own terms.

Check `generated_at` on every run. If it moves, the feed is alive again.

### 4.5 Workable caps at 20 with no offset

`jobs.workable.com/api/v1/jobs?query=&location=Israel&limit=20` returns at most
20 rows and offers no paging. The only way to see more is to partition the query
space — by city, or by role word — and merge. The script's partitioning is
crude (it splits your regex on `|`), so treat Workable as a bonus source, not a
dependable one.

### 4.6 Blank locations are kept on purpose

`hit()` accepts a job whose location field is empty, because Israeli boards
routinely leave it blank when the whole company is here. You will get a few
foreign roles to drop by hand. That is the intended trade — the alternative
drops real Israeli jobs.

### 4.7 Titles lie in both directions

`SKIP` removes "Software Engineer", "Data Engineer" and friends, because the GTM
family wants "Sales Engineer" and a bare `\bengineer\b` would catch both. If you
write a new `--pattern`, check what `SKIP` will remove from it before you trust
a low hit count.

---

## 5. Choose the roles

Sort by what was actually asked for, not by date. For a "GTM engineers and
similar" ask, the order is:

1. Literal **GTM Engineer** titles.
2. **RevOps / Revenue Operations.**
3. **Sales Ops, Marketing Ops, BizOps, Marketing Automation.**
4. Only if short: Solutions / Sales Engineers (pre-sales is an adjacent family,
   not the same one) and Growth Marketing.

Spread across companies. Three monday.com roles in a ten-item list is a worse
digest than three different employers, even if monday.com's are fresher.

Read the actual description before writing about a job. Most postings open with
three paragraphs of company boilerplate; the real content starts at "About the
role" or the responsibilities bullets. Describe **the job**, never the company's
self-description.

---

## 6. Write the message

### The template the owner uses

```
משרה להגשה עצמית:
{אייקון} טייטל:
{אייקון}תיאור משרה:
לינק לפרטים נוספים / מייל להגשה
```

Follow it exactly. Icons used so far: 💼 title, 📝 description, 🔗 link.
Company and city go on the title line. Comeet rows carry an apply-by-email
alias in the `email` field (e.g. `cognyte.C6.07D@applynow.io`) — it is published
by the employer for exactly this purpose, so it is fine to include where the
template asks for a מייל להגשה.

### Hebrew register

A jobs broadcast is semi-formal, roughly 6/10. Practical, not chatty. `תכל'ס`
survives at that register; `יאללה` and `אחי` do not.

Load the `hebrew-writer` skill if it is available to you. The parts that matter
most here:

- **No em dashes (—) anywhere.** Use a comma, a period, or parentheses.
- **Banned vocabulary**, every one of which will appear in a job ad and must not
  survive into your text: מגוון, מרתק, חיוני, מהותי, ייחודי, רב-ממדי, מקיף,
  חדשני, פורץ דרך, חסר תקדים, משמעותי, מרכזי, בולט, רלוונטי, רב-תכליתי, מאתגר.
- **No formal connectors**: לפיכך, יתר על כן, כמו כן, אי לכך. Use אז, גם, אבל, כי.
- **Vary sentence length.** Never three in a row at the same length.
- Describe concretely. "בונים אוטומציות ואינטגרציות שיושבות על ההכנסות" beats
  "תפקיד מרתק בסביבה חדשנית" — and the second one is two banned words.

Write in Hebrew. Do not write in English and translate.

---

## 7. Before you hand it over

- [ ] `board errors` was 0, or every error is explained.
- [ ] Every link returned 200, or a 403 was resolved against the ATS API (§4.2).
- [ ] No Comeet row is described as "posted" on a date (§4.1).
- [ ] Every job is at an Israeli company and located in Israel.
- [ ] Every description came from the posting. Nothing invented, no company
      marketing copy repeated as fact.
- [ ] Anything outside the requested window is flagged in the text itself.
- [ ] No banned vocabulary, no em dash.
- [ ] Count matches the ask ("up to 10" means at most 10).
- [ ] State plainly what the sweep could not cover.

---

## 8. When the sweep comes back thin

In order of what actually helps:

1. **Widen the window** before widening the role family. A 45-day job is still
   open; a wrong-family job is noise.
2. **Widen the family by one adjacent ring** and say so in the message.
3. **Check the error list again.** Thin results and a non-zero error count
   usually mean a parser bug, not an empty market.
4. **Report the shortfall.** Six good jobs honestly described beats ten padded
   with roles nobody asked for.

Do not reach for a banned source because the permitted ones were quiet. That is
the exact moment the rule in §1 exists for.

---

## 9. What you cannot reach from here

The live `jobs` table in Supabase holds far more than these feeds — everything
ever ingested, including the public Facebook groups. Reading it needs the
Supabase MCP server authorised, which the owner does through `/mcp` in an
interactive session. If it is connected, query it first; it is a much better
starting point than re-probing 289 boards.

This sweep exists because it works **without** that access. It reads the sources
directly and depends on nothing but the seed file.

---

## Reference

- `docs/data-sources-and-legal.md` — the four-question test every source passes,
  and the specific terms clause behind each refusal.
- `docs/lessons-learned.md` — the traps that cost real time on this project.
- `data/companies.seed.json` — the 289 employer boards, with provider and token.
- `scripts/seed/role_sweep.py` — the script this document is about.
