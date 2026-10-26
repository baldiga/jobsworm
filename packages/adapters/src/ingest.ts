/**
 * ATS ingestion loop - PLAN.md section 4.2.
 *
 * Leases due companies, pulls their public ATS feed, decomposes each posting
 * with the rules in `@jobsworm/core`, applies the tech-only gate (4.5), upserts
 * on `(source_provider, source_external_id)`, and closes anything the employer
 * stopped listing. One `runs` row per company, always written, success or not.
 */

import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decompose, normalizeHe, stripHtml } from "@jobsworm/core";

import { adapterFor } from "./index";
import type { RawJob } from "./types";

const DEFAULT_INTERVAL_HOURS = 12;
const BUSY_INTERVAL_HOURS = 4;
const IDLE_INTERVAL_HOURS = 48;
const LEASE_MINUTES = 15;
const MAX_FAILURES = 10;
const EXCERPT_CHARS = 300;
const UPSERT_CHUNK = 100;

/**
 * Rewrite an unchanged row anyway once it is this old.
 *
 * Mirrors `import-scraped.ts`, and for the same reason: a row that is never
 * written never has its `last_seen_at` pushed forward either, and `last_seen_at`
 * is what `expire_stale_jobs` reads. Three days keeps expiry honest with a
 * comfortable margin while still collapsing an hourly rewrite of the whole ATS
 * index into one rewrite per row per three days.
 */
const REFRESH_AFTER_DAYS = 3;

/**
 * Hash of everything an ingest would actually write.
 *
 * Excludes `last_seen_at`, which changes on every run by construction and would
 * make every row look different — the exact bug this exists to prevent. Unlike
 * the scraped importer there is no `expires_at` to exclude: ATS rows do not
 * carry one, because an employer's own feed dropping a job is what closes it.
 */
function contentHash(row: Record<string, unknown>): string {
  const { last_seen_at: _l, content_hash: _h, ...rest } = row;
  return createHash("sha256")
    .update(JSON.stringify(rest, Object.keys(rest).sort()))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Idle between writes, so a background crawl cannot starve the live site.
 *
 * This loop runs from Vercel Cron and writes flat out for its whole budget:
 * company after company, 100-row chunks back to back, no gap. Every row
 * rebuilds a generated tsvector behind a GIN index, so that is sustained CPU on
 * an instance that shares it, and on 2026-09-09 it took the site down twice —
 * search and the home page counters both returning "canceling statement due to
 * statement timeout" while the cron itself reported success.
 *
 * The scraped-source importer was paced that morning. This path was missed,
 * which was the one that actually ran in production every ten minutes.
 *
 * Same rule as there: idle for as long as the last write took. Half the CPU
 * goes to people looking for a job, the crawl takes twice as long, and nobody
 * is waiting on the crawl.
 */
const PACE_MIN_MS = 150;
const PACE_MAX_MS = 3_000;

/** Sleep for as long as `startedAt` took, within the bounds above. */
function paceAfter(startedAt: number): Promise<void> {
  const took = Date.now() - startedAt;
  return new Promise((r) => setTimeout(r, Math.min(PACE_MAX_MS, Math.max(PACE_MIN_MS, took))));
}

export interface IngestOptions {
  limit?: number;
  budgetMs?: number;
  companyDomain?: string;
  dryRun?: boolean;
  maxJobsPerCompany?: number;
  onProgress?: (line: string) => void;
}

export interface CompanyResult {
  company: string;
  provider: string;
  fetched: number;
  upserted: number;
  /** Fetched, identical to what is stored, and seen recently — so left alone. */
  skippedUnchanged: number;
  closed: number;
  droppedNonTech: number;
  droppedAbroad: number;
  error: string | null;
  ms: number;
}

export interface IngestSummary {
  companies: number;
  fetched: number;
  upserted: number;
  skippedUnchanged: number;
  closed: number;
  droppedNonTech: number;
  droppedAbroad: number;
  failed: number;
  ms: number;
  results: CompanyResult[];
}

interface CompanyRecord {
  id: string;
  name_en: string | null;
  domain: string | null;
  industry: string | null;
  ats_provider: string | null;
  ats_token: string | null;
  fail_count: number | null;
}

const COMPANY_COLUMNS =
  "id, name_en, domain, industry, ats_provider, ats_token, fail_count";

export function createIngestClient(): SupabaseClient {
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

function fingerprint(companyId: string, titleNorm: string, city: string | null): string {
  return createHash("sha256")
    .update(companyId + "|" + titleNorm + "|" + (city ?? ""))
    .digest("hex")
    .slice(0, 32);
}

function hoursFromOpenCount(openCount: number): number {
  if (openCount === 0) return IDLE_INTERVAL_HOURS;
  if (openCount > 50) return BUSY_INTERVAL_HOURS;
  return DEFAULT_INTERVAL_HOURS;
}

function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

export type RejectReason = "non_tech" | "abroad";

/**
 * Maps one decomposed posting onto a `jobs` row.
 * Returns a reason string instead when a gate rejects the posting.
 *
 * Two gates apply, both from PLAN.md: the tech-only gate (4.5) and the market
 * gate (section 0 - Israel only). Many Israeli employers run one global board,
 * so without the second gate roughly 60% of the index is Bangalore and Austin.
 */
function toJobRow(company: CompanyRecord, raw: RawJob, provider: string) {
  const descriptionText = stripHtml(raw.descriptionHtml);

  const d = decompose({
    titleRaw: raw.title,
    descriptionText,
    locationRaw: raw.locationRaw,
    companyName: company.name_en,
    companyIndustry: company.industry,
    source: provider,
    departmentRaw: raw.department ?? null,
    salaryRaw: raw.salaryRaw ?? null,
  });

  if (!d.isTech) return "non_tech" as const;
  if (d.location?.abroad === true) return "abroad" as const;

  const city = d.location?.city ?? null;

  return {
    company_id: company.id,
    source_provider: provider,
    source_external_id: raw.externalId,
    source_url: raw.applyUrl,
    fingerprint: fingerprint(company.id, d.titleNorm, city),
    title_raw: d.titleRaw,
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
    apply_url: raw.applyUrl,
    apply_method: d.applyMethod,
    description_html: raw.descriptionHtml,
    description_text: descriptionText,
    description_norm: normalizeHe(descriptionText),
    excerpt: descriptionText.slice(0, EXCERPT_CHARS),
    lang: d.lang,
    status: "open" as const,
    is_agency: d.isAgency,
    is_social_only: false,
    company_hidden: false,
    quality_flags: d.qualityFlags,
    posted_at: raw.postedAt,
    last_seen_at: new Date().toISOString(),
    // Filled in by the caller once the row is complete; see contentHash().
    content_hash: null as string | null,
  };
}

async function ingestCompany(
  supabase: SupabaseClient,
  company: CompanyRecord,
  options: IngestOptions,
): Promise<CompanyResult> {
  const started = Date.now();
  const provider = company.ats_provider ?? "generic";
  const label = company.name_en ?? company.domain ?? company.id;
  const result: CompanyResult = {
    company: label,
    provider,
    fetched: 0,
    upserted: 0,
    skippedUnchanged: 0,
    closed: 0,
    droppedNonTech: 0,
    droppedAbroad: 0,
    error: null,
    ms: 0,
  };

  const adapter = adapterFor(provider);
  if (!adapter || !company.ats_token) {
    result.error = adapter ? "missing ats_token" : "no adapter for " + provider;
    result.ms = Date.now() - started;
    return result;
  }

  try {
    const rawJobs = await adapter.fetchJobs(company.ats_token, {
      maxJobs: options.maxJobsPerCompany,
    });
    result.fetched = rawJobs.length;

    const rows = [];
    for (const raw of rawJobs) {
      const row = toJobRow(company, raw, provider);
      if (row === "non_tech") result.droppedNonTech++;
      else if (row === "abroad") result.droppedAbroad++;
      else rows.push(row);
    }

    for (const r of rows) r.content_hash = contentHash(r);

    if (options.dryRun) {
      result.upserted = rows.length;
      result.ms = Date.now() - started;
      return result;
    }

    /*
     * Read the employer's currently-open rows ONCE, before writing.
     *
     * This select already existed below, to work out what the employer had
     * stopped listing. It now also carries `content_hash` and `last_seen_at`,
     * because the skip decision needs exactly the same rows — so the whole
     * hash comparison costs no extra round trip.
     *
     * Reading before the upsert rather than after is safe: what gets closed is
     * decided by diffing against `seen`, which comes from the fetched feed, not
     * from the database. A row this pass inserts is in `seen` by construction
     * and can never be closed by its own run.
     */
    const { data: openRows, error: openError } = await supabase
      .from("jobs")
      .select("id, source_external_id, content_hash, last_seen_at")
      .eq("company_id", company.id)
      .eq("source_provider", provider)
      .eq("status", "open");
    if (openError) throw new Error(openError.message);

    /*
     * Write only what has actually changed.
     *
     * An employer's ATS feed is nearly static between passes — the same twenty
     * jobs, unchanged, hour after hour. An UPDATE that changes nothing still
     * writes a new tuple, an entry in every index, and WAL; `jobs` carries a GIN
     * index over a generated tsvector, so that is real CPU on an instance that
     * shares it with live search. This is the same skip the scraped importer
     * already does, and it is what makes an hourly ingest timer affordable.
     */
    const stored = new Map(
      (openRows ?? []).map((r: { source_external_id: string }) => [r.source_external_id, r]),
    );
    const cutoff = Date.now() - REFRESH_AFTER_DAYS * 86_400_000;
    const toWrite = rows.filter((r) => {
      const prev = stored.get(r.source_external_id as string) as
        | { content_hash: string | null; last_seen_at: string | null }
        | undefined;
      if (!prev || prev.content_hash !== r.content_hash) return true;
      const seenAt = prev.last_seen_at ? Date.parse(prev.last_seen_at) : 0;
      return !(seenAt > cutoff); // unchanged AND seen recently -> leave it alone
    });
    result.skippedUnchanged = rows.length - toWrite.length;

    for (let i = 0; i < toWrite.length; i += UPSERT_CHUNK) {
      const writeAt = Date.now();
      const { error } = await supabase
        .from("jobs")
        .upsert(toWrite.slice(i, i + UPSERT_CHUNK), {
          onConflict: "source_provider,source_external_id",
        });
      if (error) throw new Error(error.message);
      result.upserted += Math.min(UPSERT_CHUNK, toWrite.length - i);
      await paceAfter(writeAt);
    }

    /*
     * Close what the employer no longer lists — in one statement.
     *
     * The diff used to happen here in JavaScript, then travel back as chunked
     * lists of ids. `close_missing_jobs` (0039) does it next to the data, and
     * carries a guard the JavaScript never had: it is told how many rows the
     * ATS feed itself returned, and refuses to close anything when that is
     * zero. An empty feed is far more often a broken fetch than an employer
     * who closed every role at once.
     */
    const closeAt = Date.now();
    const { data: closedCount, error: closeError } = await supabase.rpc("close_missing_jobs", {
      p_company_id: company.id,
      p_provider: provider,
      p_seen: rows.map((r) => r.source_external_id),
      p_fetched: rawJobs.length,
    });
    if (closeError) throw new Error("close_missing_jobs: " + closeError.message);
    await paceAfter(closeAt);
    result.closed = Number(closedCount) || 0;

    const openCount = (openRows?.length ?? 0) - result.closed + rows.length;
    const hours = hoursFromOpenCount(openCount);
    await supabase
      .from("companies")
      .update({
        next_run_at: inHours(hours),
        interval_hours: hours,
        lease_until: null,
        fail_count: 0,
        crawl_status: "active",
      })
      .eq("id", company.id);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);

    const failures = (company.fail_count ?? 0) + 1;
    // Exponential backoff capped at 24h, then the company is marked dead.
    const backoff = Math.min(24, Math.pow(2, Math.min(failures, 5)));
    await supabase
      .from("companies")
      .update({
        fail_count: failures,
        next_run_at: inHours(backoff),
        lease_until: null,
        crawl_status: failures >= MAX_FAILURES ? "dead" : "active",
      })
      .eq("id", company.id);
  }

  result.ms = Date.now() - started;

  if (!options.dryRun) {
    // Column names must match 0003_core.sql. The result was previously ignored,
    // which let every run-log write fail silently against a mismatched schema.
    const { error: runError } = await supabase.from("runs").insert({
      kind: "ats",
      company_id: company.id,
      status: result.error ? "error" : "ok",
      rung: 0,
      items_seen: result.fetched,
      items_upserted: result.upserted,
      items_closed: result.closed,
      items_failed: result.droppedNonTech + result.droppedAbroad,
      spend: { provider, dropped_non_tech: result.droppedNonTech, dropped_abroad: result.droppedAbroad },
      error: result.error,
      started_at: new Date(started).toISOString(),
      finished_at: new Date().toISOString(),
    });
    if (runError) options.onProgress?.("  run-log write failed: " + runError.message);
  }

  return result;
}

export async function runIngestPass(options: IngestOptions = {}): Promise<IngestSummary> {
  const started = Date.now();
  const limit = options.limit ?? 40;
  const budgetMs = options.budgetMs ?? 45_000;
  const log = options.onProgress ?? (() => {});
  const supabase = createIngestClient();

  let companies: CompanyRecord[] = [];

  if (options.companyDomain) {
    const { data, error } = await supabase
      .from("companies")
      .select(COMPANY_COLUMNS)
      .eq("domain", options.companyDomain)
      .limit(1);
    if (error) throw new Error(error.message);
    companies = (data ?? []) as CompanyRecord[];
  } else if (options.dryRun) {
    // A dry run must not take a lease: it writes nothing, and holding rows for
    // fifteen minutes would starve the real pass that follows it.
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("companies")
      .select(COMPANY_COLUMNS)
      .eq("crawl_status", "active")
      .not("ats_token", "is", null)
      .lte("next_run_at", nowIso)
      .or("lease_until.is.null,lease_until.lt." + nowIso)
      .order("next_run_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    companies = (data ?? []) as CompanyRecord[];
  } else {
    /*
     * Lease atomically (0039_ingest_rpcs.sql).
     *
     * This used to be a SELECT followed by an UPDATE, which is not a lease at
     * all: between the two statements a second pass selects the same rows.
     * That was survivable while the loop only ran when somebody typed a
     * command. It stopped being survivable the day it moved onto an hourly
     * timer that can overlap a manual run.
     */
    const { data, error } = await supabase.rpc("lease_companies", {
      p_limit: limit,
      p_lease_minutes: LEASE_MINUTES,
    });
    if (error) throw new Error("lease_companies: " + error.message);
    companies = (data ?? []) as CompanyRecord[];
  }

  if (!companies.length) {
    log("0 companies due");
    return {
      companies: 0,
      fetched: 0,
      upserted: 0,
      skippedUnchanged: 0,
      closed: 0,
      droppedNonTech: 0,
      droppedAbroad: 0,
      failed: 0,
      ms: Date.now() - started,
      results: [],
    };
  }

  const results: CompanyResult[] = [];
  for (const company of companies) {
    if (Date.now() - started > budgetMs) {
      log("budget reached, stopping after " + results.length + "/" + companies.length);
      const remaining = companies.slice(results.length).map((c) => c.id);
      if (remaining.length && !options.dryRun) {
        await supabase.from("companies").update({ lease_until: null }).in("id", remaining);
      }
      break;
    }

    const companyAt = Date.now();
    const r = await ingestCompany(supabase, company, options);
    results.push(r);
    // And a breath between employers, for the same reason.
    await paceAfter(companyAt);
    log(
      r.error
        ? "  " + r.company + " [" + r.provider + "] FAILED: " + r.error
        : "  " +
            r.company +
            " [" +
            r.provider +
            "] fetched=" +
            r.fetched +
            " kept=" +
            r.upserted +
            " unchanged=" +
            r.skippedUnchanged +
            " closed=" +
            r.closed +
            " dropped=" +
            r.droppedNonTech +
            " abroad=" +
            r.droppedAbroad +
            " " +
            r.ms +
            "ms",
    );
  }

  return {
    companies: results.length,
    fetched: results.reduce((n, r) => n + r.fetched, 0),
    upserted: results.reduce((n, r) => n + r.upserted, 0),
    skippedUnchanged: results.reduce((n, r) => n + r.skippedUnchanged, 0),
    closed: results.reduce((n, r) => n + r.closed, 0),
    droppedNonTech: results.reduce((n, r) => n + r.droppedNonTech, 0),
    droppedAbroad: results.reduce((n, r) => n + r.droppedAbroad, 0),
    failed: results.filter((r) => r.error).length,
    ms: Date.now() - started,
    results,
  };
}
