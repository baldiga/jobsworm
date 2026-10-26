/**
 * ATS adapter contract — PLAN.md section 4.2.
 *
 * Every adapter hits the provider's public, unauthenticated job-board JSON
 * endpoint (the same feed that powers the employer's own careers page) and maps
 * the result to `RawJob`. Decomposition happens later, in `@jobsworm/core`.
 */

/** `companies.ats_provider` enum. */
export type AtsProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "comeet"
  | "workable"
  | "smartrecruiters"
  | "recruitee"
  | "workday"
  | "personio"
  | "bamboohr"
  | "generic";

export interface RawJob {
  /** Provider-scoped id. Unique with `provider` in `jobs`. */
  externalId: string;
  title: string;
  descriptionHtml: string;
  locationRaw: string;
  /** ISO-8601, or null when the feed does not expose a date. */
  postedAt: string | null;
  applyUrl: string;
  department?: string;
  salaryRaw?: string;
}

export interface DetectResult {
  /** The value stored in `companies.ats_token`. */
  token: string;
  feedUrl: string;
}

export interface FetchOptions {
  /** Hard ceiling on jobs pulled per company, for adapters that paginate. */
  maxJobs?: number;
  signal?: AbortSignal;
}

export interface Adapter {
  provider: AtsProvider;
  /** The public feed URL for a stored token. Never contains a secret. */
  buildFeedUrl(token: string): string;
  fetchJobs(token: string, options?: FetchOptions): Promise<RawJob[]>;
  /** Extract the token from a careers page, when it is embedded there. */
  detect?(html: string, url: string): DetectResult | null;
}

/** Per-company crawl state, mirrored from the `companies` table. */
export interface CompanyRow {
  id: string;
  name_en: string | null;
  name_he: string | null;
  domain: string | null;
  industry: string | null;
  ats_provider: AtsProvider | null;
  ats_token: string | null;
  ats_feed_url: string | null;
  crawl_status: string | null;
  next_run_at: string | null;
  lease_until: string | null;
  fail_count: number | null;
  interval_hours: number | null;
}

/** One `runs` row — PLAN.md section 4.2 step 5. */
export interface RunReport {
  company_id: string | null;
  source: AtsProvider | string;
  pages: number;
  jobs_parsed: number;
  jobs_new: number;
  jobs_closed: number;
  dropped_non_tech: number;
  errors: number;
  error_message: string | null;
  duration_ms: number;
}
