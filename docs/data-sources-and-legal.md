# Data sources and the law

Which sources Jobsworm reads, why each one is considered acceptable, and which ones it
deliberately does not read. If you deploy this code or add a source, this page is the
reasoning to check your own decisions against — it is not legal advice, and it reflects
one project's reading of Israeli sources in 2026.

> **Use at your own risk.** Whether you may collect, store and republish any content
> depends on your jurisdiction, the source's terms of service, and the data-protection
> law that applies to you (the GDPR in Europe, the Privacy Protection Law and its
> Amendment 13 in Israel, and so on). You alone are responsible for that determination
> and for complying with it. The software is provided "as is", without warranty, under
> the [MIT License](../LICENSE). If you are unsure, ask a lawyer before you run it.

## The test every source has to pass

1. **Is it public?** Nothing behind a login, an account, a paywall or a group membership.
2. **Do the terms of use allow it?** Read the terms, not just `robots.txt`. A
   `robots.txt` that allows crawling says nothing about whether you may republish what
   you crawl, and Israeli job boards' terms almost universally forbid exactly that.
3. **Is there an explicit grant?** Best of all is a source that publishes in order to be
   aggregated (an employer's ATS feed), a documented partner feed, or a machine-readable
   grant such as Cloudflare's `Content-Signal: search=yes`.
4. **What personal data does it carry, and can we avoid keeping it?** Store the least
   that makes the listing useful.

## Sources that ship

| source | why it is used | what is kept |
|---|---|---|
| **Employer ATS feeds** (Comeet, Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee) | Public, documented endpoints the employer's own careers page calls. The employer publishes them so their jobs can be found. | The posting, linked back to the employer's own application page. |
| **Drushim-Avodot** (`drushimavodot`) | A documented partner API that asks for attribution in return. The site shows that attribution. | Postings in tech categories only. |
| **Workable's public job board** | The vendor's own aggregated board across its customers. Its `robots.txt` carries `Content-Signal: search=yes`, an express grant to build a search index with links and short excerpts. | Postings located in Israel. |
| **RevHub** | A small, hand-curated go-to-market feed published as static JSON. | Employer and role only. Contact details in the feed (emails, phones, LinkedIn URLs of individuals) are read and discarded; rows whose only apply route is a personal contact are dropped. |
| **Public Facebook groups** — `fb-scrape`, `fb-posts`, `fb-apify` | Publicly visible posts in public groups, read without logging in, or through an Apify actor that reads public groups. **At your own risk; see below.** | A salted hash of the poster and a coarse poster type, never a name or profile. Excerpts capped at 300 characters, with a link to the original post. Raw posts deleted after 30 days. |

### About the Facebook sources

They are enabled in this repository because the original deployment used them, and
they are the part of the system most likely to be unsuitable for yours.

- Facebook's terms restrict automated collection. Reading public pages without logging
  in, and buying results from a third party that does, are both still subject to them.
- Group posts are written by private individuals. Even with names hashed and excerpts
  short, the content is personal data in many jurisdictions.
- Apify's actors are third-party software with their own terms; Apify itself states
  that users are responsible for the legality of what they scrape.

If you keep them: public groups only (the code enforces this), hash poster identities,
keep excerpts short with a link back, honour takedowns quickly, and say on your privacy
page that you collect from public groups. If you drop them, delete the `fb-*` steps from
`.github/workflows/scrape.yml` and `social.yml`; nothing else depends on them.

## Sources that do not ship

| source | why not |
|---|---|
| **AllJobs** | Terms forbid republishing listings. |
| **Drushim** (the Yad2 jobs vertical) | Terms forbid republishing listings. Not to be confused with Drushim-Avodot above, a different company. |
| **Yad2** | Terms forbid republishing; also behind an aggressive bot wall. |
| **Secret Tel Aviv jobs board** | The jobs subdomain's own terms page was an empty placeholder, but the operator's terms on the parent domain cover the board and forbid reposting listings "on other platform(s)". A subdomain is not a separate legal entity. |
| **JobMaster, TechJob, TheJob** and similar Israeli boards | The same republication clause. One of them serves `robots.txt` `Allow: /` regardless. |
| **Janglo** | Terms forbid robots and scrapers by name. |
| **LinkedIn posts** | The User Agreement forbids copying or distributing content obtained "directly or through third parties (such as ... data aggregators or brokers)", which covers buying it from a scraping vendor. |
| **Logged-in Facebook reading** | Requires an account session, breaches Facebook's terms, risks the account, and can reach private groups. |

`WITHHELD_SOURCES` in `packages/adapters/src/import-scraped.ts` refuses these names, so
nothing collected under them can be imported, even by accident.

## Legitimate sources that were not worth it

Recorded so nobody spends a day rediscovering them:

- **Feeds that grant republication but carry no Israeli jobs:** OnJob.io (2,615 jobs on
  page one, none in Israel), startup.jobs (one Israeli mention in 50).
- **Paid job-data APIs** with real Israeli coverage exist (from about $1 per 1,000
  postings, or a few hundred dollars a month per country). A budget decision, not a
  technical one.
- **Nefesh B'Nefesh's job board** had no anti-scraping clause when checked and about
  1,000 jobs, but no feed; it would need an HTML crawler.

## Personal data this system collects

This describes what a running deployment of this code collects, so that you know what
you are taking on if you deploy it. **The original deployment holds none of it any
more:** the site was retired in October 2026 and its database, including every account
and every uploaded CV, was deleted outright.

- **Job seekers** who sign up: email, saved jobs and searches, and a CV if uploaded.
  Consent is recorded with a hash of the exact text shown (`apps/web/lib/consent.ts`).
  CVs stop being used for matching after 90 days; inactive accounts are deleted after
  12 months; deletion from `/me` removes everything in one step.
- **Never collected:** age, gender, family status, health, religion, military unit, ID
  numbers, photos.
- **Recruiters** who post: their account email and the listings they submit.
- **Social posters:** a salted hash and a poster type, as above. The salt lives in the
  environment, so hashes are not reversible from a database dump alone.

If you run your own deployment, you are the controller of this data. Rewrite the privacy
page, terms and consent text for your organisation and jurisdiction, and add a new
consent version rather than editing the old one.

## Takedowns

The original site committed to removing any content within 48 hours of a request from
its author or owner, and kept to that until it shut down.

There is nothing left to take down. The index was deleted with the database in October
2026, and no job content ships in this repository: `data/companies.seed.json` is a list
of employers and the public board slugs their own careers pages already expose, not
postings. If you believe something here is yours and should not be, open an issue.

If you run your own deployment, publish a number of hours and keep to it. A takedown
promise with no address behind it is worse than no promise.
