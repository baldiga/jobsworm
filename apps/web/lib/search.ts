import { createReadClient, supabaseConfigured } from "@/lib/supabase";
import type { JobRow, SearchFilters } from "@/lib/types";

export type SearchResult = {
  jobs: JobRow[];
  total: number;
  ready: boolean;
  error: string | null;
};

const PAGE_SIZE = 20;

export function filtersFromParams(sp: URLSearchParams): SearchFilters {
  const list = (k: string) => {
    const v = sp.getAll(k).filter(Boolean);
    return v.length ? v : undefined;
  };
  const days = Number(sp.get("since"));
  return {
    remote: list("remote"),
    seniority: list("seniority"),
    regions: list("region"),
    functions: list("function"),
    employment_types: list("employment"),
    skills: list("skill"),
    has_salary: sp.get("salary") === "1" ? true : undefined,
    posted_within_days: Number.isFinite(days) && days > 0 ? days : undefined,
  };
}

/** Strip undefined so the RPC receives a clean jsonb object. */
function compact(filters: SearchFilters): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined && v !== null),
  );
}

export async function searchJobs(
  q: string,
  filters: SearchFilters,
  page = 1,
): Promise<SearchResult> {
  if (!supabaseConfigured) {
    return { jobs: [], total: 0, ready: false, error: null };
  }

  const supabase = await createReadClient();
  const payload = compact(filters);
  const offset = (page - 1) * PAGE_SIZE;

  const [rows, count] = await Promise.all([
    supabase.rpc("search_jobs", {
      q,
      p_filters: payload,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    }),
    supabase.rpc("search_jobs_count", { q, p_filters: payload }),
  ]);

  if (rows.error) {
    return { jobs: [], total: 0, ready: false, error: rows.error.message };
  }

  const jobs = (rows.data ?? []) as JobRow[];
  await attachCompanies(supabase, jobs);

  return {
    jobs,
    total: Number(count.data ?? jobs.length),
    ready: true,
    error: null,
  };
}

/**
 * The narrowest shape of a Supabase client this helper needs, so it accepts the
 * read, action and admin clients without importing or re-deriving any of them.
 *
 * `any` is deliberate and is the reason for the disable below. Writing out the
 * structural shape of the query builder instead (`select(...)` returning
 * `in(...)` returning a thenable) makes TypeScript check the real builder —
 * which carries deep conditional types over the whole database schema —
 * against it, and that fails the build outright with TS2589 "type
 * instantiation is excessively deep". The row type is asserted at the point of
 * use below, so nothing downstream is actually untyped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MinimalClient = { from: (t: string) => any };

/** The search RPC returns job rows only; join company names in one extra query. */
export async function attachCompanies(supabase: MinimalClient, jobs: JobRow[]) {
  const ids = [...new Set(jobs.map((j) => j.company_id).filter(Boolean))] as string[];
  if (!ids.length) return;

  const { data } = await supabase
    .from("companies")
    .select("id, slug, name_en, name_he, domain")
    .in("id", ids);

  type CompanyLite = {
    id: string;
    slug: string;
    name_en: string | null;
    name_he: string | null;
    domain: string | null;
  };
  const rows = (data ?? []) as CompanyLite[];
  const byId = new Map<string, CompanyLite>(rows.map((c) => [c.id, c]));
  for (const job of jobs) {
    const c = job.company_id ? byId.get(job.company_id) : null;
    if (!c) continue;
    job.company_name = c.name_he || c.name_en || c.domain;
    job.company_slug = c.slug;
    job.company_domain = c.domain;
  }
}

export { PAGE_SIZE };
