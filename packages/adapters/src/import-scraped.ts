/**
 * Imports scraped postings into `jobs`.
 *
 * The Python worker fetches and parses; this decomposes and upserts. Keeping
 * decomposition here means the dictionaries, the tech-only gate (PLAN.md 4.5)
 * and the Israel gate exist in exactly one place, shared with the ATS path.
 *
 * Policy per PLAN.md 4.3 and 4.4:
 *   - link-out only: `apply_url` is the listing or post URL, never a form
 *   - excerpt capped at 300 characters
 *   - AllJobs and Yad2 expire 14 days after the last sighting
 *   - Facebook posts expire 21 days after posting
 *   - agency postings are stored but flagged, so the index can hide them
 */

import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decompose, normalizeHe, stripHtml, isJobSeekerPost } from "@jobsworm/core";
import { socialTitle } from "./social-title";
import { scrub, scrubOrNull } from "./scrub";
import { isTechCategory, CATEGORY_GATED_SOURCES } from "./feed-category";

const EXCERPT_CHARS = 300;
const UPSERT_CHUNK = 100;

/**
 * Scraped sources whose crawl is already restricted to tech hiring, so a
 * business-function role found in them counts as a tech-company role.
 */
const TECH_CONTEXT_SOURCES = new Set([
  "facebook",
  // A curated go-to-market feed. Every row is SDR, AE, RevOps, CS or
  // marketing AT a tech company — that is the entire premise of the feed — so
  // its business-function roles are exactly the ones PLAN.md 4.5 means to keep.
  "revhub",
]);

/*
 * `drushimavodot` is deliberately absent from that set. The others are crawled
 * only where tech hiring happens — tech board categories, hi-tech groups — so a
 * marketing role found in them is a marketing role at a tech company. The
 * Drushim-Avodot feed is a GENERAL board: measured on a 500-row sample, about
 * 3% is hi-tech and the rest is nursing, restaurants and logistics. Granting it
 * tech context would let every sales and admin role on an Israeli general board
 * into a tech index.
 *
 * `workable` is absent for the same reason, though it reads as a closer call.
 * Workable is an ATS, and an ATS feed is high-quality — but it is a general
 * ATS, and the Israeli employers on its board are a genuine mix: alongside
 * AccessFintech and Healthee sit a cosmetics clinic and a merchant-funding
 * firm. "Came through an ATS" says the data is clean; it does not say the
 * employer is a tech company. The per-company isTech gate decides that, which
 * is the same rule the per-company ATS path already lives under.
 */

const EXPIRY_DAYS: Record<string, number> = {
  facebook: 21,
  drushimavodot: 14,
  // Community-curated, republished from WhatsApp. Same shelf life as a post.
  revhub: 21,
  /*
   * Workable's board is an enumeration, so closing what is missing would be
   * the natural move — except that we only ever reach ~87% of it, because the
   * API caps every answer at 20 rows and the partitions that reach the rest
   * are approximate. Feed-diffing an 87% view would close one job in eight
   * that is still open. An expiry is the honest instrument here: a row the
   * board keeps listing is refreshed on every pass, and one that genuinely
   * comes down ages out.
   */
  workable: 21,
};

/**
 * How long a social post lives when we could not read its date.
 *
 * Short on purpose. People do not delete old hiring posts the way a job board
 * closes a filled role, so an undated social post is the one most likely to be
 * months stale, and showing it for three weeks on the assumption it is new is
 * the wrong side to err on.
 */
const UNDATED_SOCIAL_DAYS = 7;

/**
 * Sources whose rows are DATED POSTS rather than board listings.
 *
 * The difference decides when a row expires, and getting it wrong defeats the
 * 30-day cap entirely. A board listing is live until the board takes it down,
 * so its clock starts when we import it. A post was written on a particular day
 * and nobody goes back to delete it, so its clock has to start from the day it
 * was written.
 *
 * This used to read `source === "facebook"`, which quietly excluded LinkedIn
 * and left three-month-old posts sitting in the index with three weeks left to
 * run, dated from whenever the importer happened to see them.
 */
const POST_SOURCES = new Set(["facebook", "linkedin", "revhub"]);

/**
 * Sources we do not import, because their terms of use forbid republishing
 * their listings.
 *
 * Their scrapers are not part of this repository. The names stay here as a
 * hard refusal, so rows collected before a source was withdrawn — or by a
 * scraper someone adds back without reading the terms — can never reach the
 * index through `--sources=...`. A default would be one flag away from
 * undoing that; a refusal is not.
 *
 *   alljobs, drushim, yad2   terms forbid republishing listings
 *   secrettelaviv            the operator's terms, on the parent domain, cover
 *                            the jobs subdomain and forbid reposting listings
 *                            "on other platform(s)"
 *   linkedin                 the User Agreement forbids distributing content
 *                            obtained "directly or through third parties",
 *                            which includes a scraping vendor
 *
 * `drushimavodot` is a different company and is NOT on this list: it publishes
 * a documented partner feed and asks for attribution, which the site shows.
 * docs/data-sources-and-legal.md has the reasoning for every source.
 */
export const WITHHELD_SOURCES = new Set([
  "alljobs",
  "drushim",
  "yad2",
  "secrettelaviv",
  "linkedin",
]);

/**
 * How stale a row may get before it is rewritten even though nothing changed.
 *
 * Skipping unchanged rows is the whole point of the content hash, but a row
 * that is never written also never has its `expires_at` pushed forward — and
 * board postings expire 14 days after their last import. Rewriting anything
 * older than three days keeps expiry honest with a comfortable margin, while
 * still turning a six-hourly rewrite of the entire index into one rewrite per
 * row per three days. That is roughly a twelvefold cut in write volume.
 */
const REFRESH_AFTER_DAYS = 3;

/**
 * Hash of everything an import would actually write.
 *
 * Deliberately excludes `last_seen_at` and `expires_at`, which change on every
 * single run by construction and would make every row look different — which is
 * the exact bug this is here to fix.
 */
function contentHash(row: Record<string, unknown>): string {
  /*
   * `content_hash` is excluded as well, so that declaring the field on the row
   * (it is assigned a line after the row is built) does not change what gets
   * hashed. Adding a key here would give every stored row a new hash and make
   * the next pass rewrite the entire index once — the write storm this whole
   * mechanism exists to prevent.
   */
  const { last_seen_at: _l, expires_at: _e, content_hash: _h, ...rest } = row;
  return createHash("sha256")
    .update(JSON.stringify(rest, Object.keys(rest).sort()))
    .digest("hex")
    .slice(0, 32);
}

export interface ImportOptions {
  sources?: string[];
  sinceHours?: number;
  dryRun?: boolean;
  onProgress?: (line: string) => void;
}

export interface ImportSummary {
  source: string;
  candidates: number;
  imported: number;
  droppedNonTech: number;
  droppedAbroad: number;
  droppedIncomplete: number;
  /** Somebody advertising themselves rather than an opening. */
  droppedSeeker: number;
  /** Already stored unchanged, so not rewritten. */
  skippedUnchanged: number;
}

/** One posting as written by the Python worker into `raw_pages.meta.jobs`. */
interface ScrapedJob {
  external_id: string;
  title: string;
  description_html: string;
  location_raw: string;
  apply_url: string;
  source: string;
  company_name?: string | null;
  posted_at?: string | null;
  employment_type_raw?: string | null;
  salary_raw?: string | null;
  is_agency_hint?: boolean;
  company_hidden?: boolean;
  meta?: Record<string, unknown>;
}

function client(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function fingerprint(company: string, titleNorm: string, city: string | null): string {
  return createHash("sha256")
    .update(company + "|" + titleNorm + "|" + (city ?? ""))
    .digest("hex")
    .slice(0, 32);
}

/**
 * A publisher-supplied expiry, when the feed gives one and it parses.
 *
 * Ignores dates already in the past: a feed row that expired before we imported
 * it would otherwise be written as closed-on-arrival, which is technically
 * accurate and practically useless.
 */
function feedExpiry(meta: Record<string, unknown> | undefined): string | null {
  const raw = meta?.expires_at;
  if (typeof raw !== "string" || !raw) return null;
  const at = new Date(raw).getTime();
  if (Number.isNaN(at) || at <= Date.now()) return null;
  return new Date(at).toISOString();
}

function plusDays(days: number, from?: string | null): string {
  const base = from ? new Date(from).getTime() : Date.now();
  const start = Number.isNaN(base) ? Date.now() : base;
  return new Date(start + days * 86_400_000).toISOString();
}

/** Normalized employer name to company id, for employers we already track. */
async function companyIndex(supabase: SupabaseClient): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const { data } = await supabase.from("companies").select("id, name_en, name_he, domain");
  for (const c of data ?? []) {
    for (const name of [c.name_en, c.name_he]) {
      if (!name) continue;
      const key = String(name).trim().toLowerCase();
      if (key.length > 2 && !index.has(key)) index.set(key, c.id as string);
    }
  }
  return index;
}

/**
 * A scraped post carries no structured company or location, so a posting that
 * decomposes to nothing useful is dropped rather than stored as a blank card.
 */
function isUsable(titleNorm: string, descriptionText: string): boolean {
  return titleNorm.length > 1 && descriptionText.length >= 80;
}

/**
 * PostgREST caps an unbounded select at 1,000 rows, and does so silently.
 * A 2,277-post harvest imported exactly 1,000 before this existed, with no
 * error to notice. Any read of a table that can outgrow that has to page.
 */
/**
 * Starting page size per table, because row size varies by three orders of
 * magnitude and one constant cannot serve them all.
 *
 * A `raw_pages` row for the Drushim-Avodot feed holds a hundred complete job
 * bodies — megabytes each. Asking for a thousand of those is a request for
 * gigabytes, and it failed in a genuinely confusing way: the driver handed back
 * an "error" whose message was the payload itself, so the log filled with half
 * a megabyte of Hebrew job descriptions instead of saying what went wrong.
 */
const PAGE_SIZE_BY_TABLE: Record<string, number> = {
  raw_pages: 20,
  raw_posts: 200,
};
const DEFAULT_PAGE = 1000;
const MIN_PAGE = 5;

/** Keep a driver error readable. Some of them carry the whole response body. */
function briefly(message: string): string {
  const one = String(message ?? "").replace(/\s+/g, " ").trim();
  return one.length > 300 ? one.slice(0, 300) + `… (+${one.length - 300} more chars)` : one;
}

async function selectAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  apply: (q: ReturnType<SupabaseClient["from"]>["select"] extends never ? never : any) => any,
): Promise<T[]> {
  const out: T[] = [];
  let page = PAGE_SIZE_BY_TABLE[table] ?? DEFAULT_PAGE;
  let from = 0;

  for (;;) {
    const { data, error } = await apply(
      supabase.from(table).select(columns).range(from, from + page - 1),
    );

    if (error) {
      /*
       * Back off the page size rather than failing, for the same reason the
       * upsert does: a fixed page is a constant that silently becomes wrong as
       * rows get bigger. `raw_posts` holds the full text of every post, so a
       * thousand of them stopped fitting inside the statement timeout once the
       * Facebook corpus passed a few thousand rows.
       */
      /*
       * Halve on ANY error while there is still room to halve, not just on a
       * statement timeout. Too much data comes back in more than one disguise —
       * a timeout, a truncated body, a parse failure whose message is the body —
       * and every one of them is fixed by asking for less.
       */
      if (page > MIN_PAGE) {
        page = Math.max(MIN_PAGE, Math.floor(page / 2));
        continue;
      }
      throw new Error(`${table}: ${briefly(error.message)} (at page size ${page})`);
    }

    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < page) return out;
    from += page;
  }
}

/**
 * Upsert with a chunk size that backs off when Postgres says it is too slow.
 *
 * `jobs.search_tsv` is a generated column with a GIN index, so every row
 * written does real indexing work, and the cost grows with the table. A fixed
 * chunk size is therefore a constant that silently becomes wrong: 100 rows was
 * fine at 3,000 jobs and started tripping the statement timeout at 5,700.
 *
 * Halving on timeout and retrying keeps the import working as the table grows
 * instead of needing a new magic number each time. A row that cannot be written
 * even alone is a real error and is raised.
 *
 * It also PACES ITSELF, which is not an optimisation but an outage fix. On
 * 2026-09-09 a bulk import ran flat out — batch, batch, batch, no gap — and
 * drained the instance's burst CPU. Reads did not fail, they simply got slower
 * than the 3s anon statement timeout, so every visitor to /jobs saw "canceling
 * statement due to statement timeout" while the import itself reported success.
 * A background job that can do that to the live site is mis-designed however
 * well it handles its own errors.
 *
 * The rule below is deliberately crude: idle for as long as the last write
 * took. A ~50% duty cycle leaves the other half of the CPU for people actually
 * looking for a job, and an import that takes twice as long costs nothing —
 * nobody is waiting on it.
 */
async function upsertJobs(
  supabase: SupabaseClient,
  source: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const MIN_CHUNK = 5;
  const MAX_RETRIES = 4;
  /** Never idle less than this, and never more, between write batches. */
  const PACE_MIN_MS = 150;
  const PACE_MAX_MS = 3_000;

  let i = 0;
  let chunk = UPSERT_CHUNK;
  let sinceShrink = 0;
  let first = true;
  let pace = PACE_MIN_MS;

  while (i < rows.length) {
    if (!first) await new Promise((r) => setTimeout(r, pace));
    first = false;

    const slice = rows.slice(i, i + chunk);
    const startedAt = Date.now();
    let error = (
      await supabase
        .from("jobs")
        .upsert(slice, { onConflict: "source_provider,source_external_id" })
    ).error;
    // Match the idle to the work just done, so the site keeps half the CPU.
    pace = Math.min(PACE_MAX_MS, Math.max(PACE_MIN_MS, Date.now() - startedAt));

    /*
     * A statement timeout is usually the database being momentarily busy, not
     * this particular batch being impossible. Wait and try the same batch again
     * before concluding anything, with the delay growing each time.
     */
    for (let attempt = 1; error && attempt <= MAX_RETRIES; attempt++) {
      if (!/statement timeout|canceling statement/i.test(error.message)) break;
      await new Promise((r) => setTimeout(r, attempt * 1500));
      error = (
        await supabase
          .from("jobs")
          .upsert(slice, { onConflict: "source_provider,source_external_id" })
      ).error;
    }

    if (!error) {
      i += chunk;
      /*
       * Grow back after a run of successes. Without this the chunk only ever
       * ratchets down, so a single blip early on left every later write doing
       * one row at a time — thousands of round trips, each its own chance to
       * time out. That is how an import of 8,000 rows failed after recovering
       * from a problem it had already handled.
       */
      if (chunk < UPSERT_CHUNK && ++sinceShrink >= 5) {
        chunk = Math.min(UPSERT_CHUNK, chunk * 2);
        sinceShrink = 0;
      }
      continue;
    }

    const timedOut = /statement timeout|canceling statement/i.test(error.message);
    if (timedOut && chunk > MIN_CHUNK) {
      chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2));
      sinceShrink = 0;
      continue; // same offset, smaller batch
    }
    throw new Error(`${source}: ${error.message}`);
  }
}

export async function importScraped(options: ImportOptions = {}): Promise<ImportSummary[]> {
  const log = options.onProgress ?? (() => {});
  const sources =
    (
      options.sources ?? [
        "facebook",
        "linkedin",
        "drushimavodot",
        "revhub",
        "workable",
        "secrettelaviv",
      ]
    ).filter((s) => {
      if (!WITHHELD_SOURCES.has(s)) return true;
      log(`${s}: SKIPPED — we are not permitted to publish this source (see WITHHELD_SOURCES)`);
      return false;
    });
  const sinceHours = options.sinceHours ?? 48;
  const since = new Date(Date.now() - sinceHours * 3_600_000).toISOString();

  const supabase = client();
  const companies = await companyIndex(supabase);
  const summaries: ImportSummary[] = [];

  for (const source of sources) {
    const summary: ImportSummary = {
      source,
      candidates: 0,
      imported: 0,
      droppedNonTech: 0,
      droppedAbroad: 0,
      droppedIncomplete: 0,
      droppedSeeker: 0,
      skippedUnchanged: 0,
    };

    const scraped: ScrapedJob[] = [];

    if (source === "facebook") {
      const data = await selectAll<{
        url: string | null;
        content: string | null;
        meta: Record<string, unknown> | null;
        fetched_at: string;
      }>(supabase, "raw_posts", "url, content, meta, fetched_at", (q) =>
        q.eq("source", "facebook").gte("fetched_at", since),
      );

      for (const row of data) {
        const meta = (row.meta ?? {}) as Record<string, unknown>;
        const text = String(row.content ?? "");
        if (!text) continue;
        const firstLine = socialTitle(text);
        scraped.push({
          external_id: createHash("sha256").update(text.slice(0, 500)).digest("hex").slice(0, 24),
          title: firstLine,
          description_html: text,
          location_raw: "",
          apply_url: String(row.url ?? ""),
          source: "facebook",
          company_name: null,
          /*
           * Null when the scraper could not read the post's own date, NOT the
           * fetch time. Falling back to fetched_at made every post look freshly
           * posted the moment we found it: 98% of Facebook posts do carry a real
           * date, and for the other 2% "posted today" was a claim we invented.
           * The UI says "first seen" for those instead, and the expiry below is
           * shortened because we cannot vouch for their age.
           */
          posted_at: (meta.posted_at as string) ?? null,
          meta: { group_slug: meta.group_slug, poster_type: meta.poster_type },
        });
      }
    } else {
      const data = await selectAll<{ meta: { jobs?: ScrapedJob[] } | null }>(
        supabase,
        "raw_pages",
        "meta, fetched_at",
        (q) => q.eq("source", source).gte("fetched_at", since),
      );

      for (const row of data) {
        const meta = (row.meta ?? {}) as { jobs?: ScrapedJob[] };
        for (const job of meta.jobs ?? []) scraped.push(job);
      }
    }

    /*
     * A LinkedIn post has no title field either, and the scraper was sending
     * the first 180 characters of the post body as one. The result was job
     * cards headed by a paragraph — "We're hiring at Sentra 🚀 🇮🇱 Israel (Tel
     * Aviv) • Senior Product Manager • Software Architect • Senior Backend
     * En…" — and, worse, those paragraphs OUTRANKED real listings. A roundup
     * naming five roles matches five sets of search terms, and ts_rank_cd
     * rewards exactly that, so a search for "engineer" put four multi-role
     * posts above the first actual engineering job. This is the "variants of
     * job postings, not all relevant" a user reported.
     *
     * Facebook posts already went through socialTitle. LinkedIn never did; the
     * comment in the scraper said the decomposer would derive a real title from
     * the body, and nothing ever did.
     */
    if (source === "linkedin") {
      for (const job of scraped) {
        const derived = socialTitle(job.title || stripHtml(job.description_html));
        if (derived.length >= 6) job.title = derived;
      }
    }

    summary.candidates = scraped.length;

    const rows = [];
    /*
     * A general jobs board is gated on its own category BEFORE the classifier
     * runs. See feed-category.ts: on drushimavodot the classifier called 1,975
     * of 7,935 rows tech, including nurses and bookkeepers, because it was
     * built for feeds that are already restricted to hi-tech and has no way to
     * tell whether a Hebrew job posting is a tech job at all.
     */
    const categoryGated = CATEGORY_GATED_SOURCES.has(source);
    const isSocialSource = POST_SOURCES.has(source);

    for (const job of scraped) {
      if (categoryGated && !isTechCategory((job.meta as { category?: string } | undefined)?.category)) {
        summary.droppedNonTech++;
        continue;
      }
      const descriptionText = stripHtml(job.description_html);

      /*
       * People post their own availability into hiring groups, and every field
       * extracts perfectly from it — "אני מחפשת משרה של 100% עבודה מהבית" came
       * out as Solutions engineering, Remote, Part-time, ₪50+/month. It was on
       * the site as a job. Only social sources carry this; a board never does.
       */
      if (isSocialSource && isJobSeekerPost([job.title, descriptionText].join("\n"))) {
        summary.droppedSeeker++;
        continue;
      }

      const d = decompose({
        titleRaw: job.title,
        descriptionText,
        locationRaw: job.location_raw,
        companyName: job.company_name ?? null,
        source,
        salaryRaw: job.salary_raw ?? null,
        // These sources are curated to tech hiring at the crawl step: only
        // hi-tech board categories and approved hi-tech groups are fetched. So
        // a marketing role found here is a marketing role at a tech company,
        // which is exactly what PLAN.md 4.5 means to keep. ATS feeds are left
        // alone: they carry a real industry and do not need the inference.
        techContext: TECH_CONTEXT_SOURCES.has(source),
      });

      if (!d.isTech) {
        summary.droppedNonTech++;
        continue;
      }
      if (d.location?.abroad === true) {
        summary.droppedAbroad++;
        continue;
      }
      if (!isUsable(d.titleNorm, descriptionText)) {
        summary.droppedIncomplete++;
        continue;
      }

      const employer = (job.company_name ?? "").trim();
      const companyId = employer ? (companies.get(employer.toLowerCase()) ?? null) : null;
      const isSocial = POST_SOURCES.has(source);

      rows.push({
        company_id: companyId,
        company_name_raw: scrubOrNull(employer),
        source_provider: source,
        source_external_id: job.external_id,
        source_url: job.apply_url,
        fingerprint: fingerprint(employer || source, d.titleNorm, d.location?.city ?? null),
        title_raw: scrub(d.titleRaw),
        title_norm: d.titleNorm,
        function: d.function,
        sub_function: d.subFunction,
        seniority: d.seniority,
        req_years_min: d.reqYearsMin,
        req_years_max: d.reqYearsMax,
        employment_type: d.employmentType,
        remote: d.remote,
        hybrid_days_office: d.hybridDaysOffice,
        location: d.location,
        skills_required: d.skillsRequired,
        skills_nice: d.skillsNice,
        tech_stack: d.techStack,
        languages: d.languages,
        education: d.education,
        clearance: d.clearance,
        salary: d.salary,
        decomp_meta: d.decompMeta,
        decomp_version: d.decompVersion,
        // Link-out only, per PLAN.md 4.3 and 4.4.
        apply_url: job.apply_url,
        apply_method: "link" as const,
        description_html: scrub(job.description_html),
        description_text: scrub(descriptionText),
        description_norm: scrub(normalizeHe(descriptionText)),
        excerpt: scrub(descriptionText.slice(0, EXCERPT_CHARS)),
        lang: d.lang,
        status: "open" as const,
        is_agency: d.isAgency || Boolean(job.is_agency_hint),
        is_social_only: isSocial,
        company_hidden: Boolean(job.company_hidden) || (!employer && !isSocial),
        quality_flags: d.qualityFlags,
        posted_at: job.posted_at ?? null,
        last_seen_at: new Date().toISOString(),
        // Filled in below, once the row is complete; see contentHash().
        content_hash: null as string | null,
        /*
         * Social posts expire from the date they were POSTED, so a month-old
         * post found today is already past its window rather than getting a
         * fresh 21 days. Where the post date is unknown we cannot do that, so
         * it gets the short unverified window instead of the benefit of the
         * doubt: an undated post is exactly the one most likely to be stale.
         */
        /*
         * Publisher expiry wins when we are given one. The Drushim-Avodot feed
         * returns a real `expires_at` per row, often same-day, which is better
         * information than the fixed window this project applies everywhere
         * else. A guessed 14 days would keep a job live for two weeks after the
         * publisher had already taken it down.
         */
        expires_at:
          feedExpiry(job.meta) ??
          (isSocial && !job.posted_at
            ? plusDays(UNDATED_SOCIAL_DAYS)
            : plusDays(EXPIRY_DAYS[source] ?? 14, isSocial ? job.posted_at : null)),
      });
    }

    // A single upsert batch may not touch the same conflict target twice, and
    // the same posting legitimately appears in several scrape passes.
    const deduped = [...new Map(rows.map((r) => [r.source_external_id, r])).values()];
    for (const r of deduped) r.content_hash = contentHash(r);

    /*
     * Write only what has actually changed.
     *
     * `save_page` stamps a fresh `fetched_at` on every scrape, so the window
     * this importer reads matches every row every time and it used to re-upsert
     * the entire index — around 4,800 identical jobs, every six hours. An
     * UPDATE that changes nothing still writes a new tuple, an entry in every
     * index, and WAL; with a GIN index over a generated tsvector on this table,
     * that is genuinely expensive, and it is what kept taking the database down.
     *
     * A row is rewritten when its content differs from what is stored, or when
     * what is stored is more than REFRESH_AFTER_DAYS old — the second condition
     * exists so `expires_at` keeps moving forward for postings that never change.
     */
    let toWrite = deduped;
    if (!options.dryRun) {
      const cutoff = Date.now() - REFRESH_AFTER_DAYS * 86_400_000;
      const stored = new Map<string, { content_hash: string | null; last_seen_at: string | null }>();
      const existing = await selectAll<{
        source_external_id: string;
        content_hash: string | null;
        last_seen_at: string | null;
      }>(supabase, "jobs", "source_external_id, content_hash, last_seen_at", (q) =>
        q.eq("source_provider", source).eq("status", "open"),
      );
      for (const row of existing) stored.set(row.source_external_id, row);

      /*
       * POSTS CLOSED ON PURPOSE MUST STAY CLOSED.
       *
       * Every row here is written with `status: "open"`, and the upsert
       * conflicts on (source_provider, source_external_id) — so re-scraping a
       * post reopens it. For a social source that is every listing, every two
       * days, which means cleanup silently undoes itself. Verified: a seeker's
       * post closed at 20:05 was open again at 21:06 with `closed_at` still
       * set, because the same group was swept in between.
       *
       * Expiry is not the same thing and must keep reopening: a role that
       * lapsed and was genuinely posted again should come back. So this only
       * protects rows closed for a REASON — a non-vacancy or a dead link —
       * which is exactly what quality_flags records.
       */
      const banished = new Set<string>();
      const closedBad = await selectAll<{ source_external_id: string }>(
        supabase,
        "jobs",
        "source_external_id",
        (q) =>
          q
            .eq("source_provider", source)
            .eq("status", "closed")
            .overlaps("quality_flags", [
              "classified_ad",
              "seeker",
              "freelance_ad",
              "course_ad",
              "content_post",
              "discussion",
              "dead_link",
            ]),
      );
      for (const row of closedBad) banished.add(row.source_external_id);

      toWrite = deduped.filter((r) => {
        if (banished.has(r.source_external_id as string)) return false;
        const prev = stored.get(r.source_external_id as string);
        if (!prev || prev.content_hash !== r.content_hash) return true;
        const seen = prev.last_seen_at ? Date.parse(prev.last_seen_at) : 0;
        return !(seen > cutoff); // unchanged AND seen recently -> leave it alone
      });
      summary.skippedUnchanged = deduped.length - toWrite.length;
      if (banished.size) {
        log(`${source}: ${banished.size} previously rejected post(s) not reopened`);
      }

      await upsertJobs(supabase, source, toWrite);
    }
    summary.imported = toWrite.length;

    log(
      `${source}: ${summary.imported} written, ${summary.skippedUnchanged} unchanged, ` +
        `from ${summary.candidates} scraped ` +
        `(non-tech ${summary.droppedNonTech}, abroad ${summary.droppedAbroad}, ` +
        `incomplete ${summary.droppedIncomplete}, seeking-work ${summary.droppedSeeker})`,
    );
    summaries.push(summary);
  }

  return summaries;
}
