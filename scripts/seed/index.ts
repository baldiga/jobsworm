/**
 * Seeds `companies` from data/companies.seed.json (PLAN.md section 4.1).
 *
 * Dedupe key is the canonical domain. The union rule from the plan applies:
 * `sources[]` is merged, and a non-empty stored value is never overwritten
 * with an empty incoming one — a later, thinner source must not erase a
 * richer earlier one.
 *
 *   pnpm seed              upsert every company
 *   pnpm seed --dry-run    report what would change, write nothing
 */
import { config as loadEnv } from "dotenv";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// .env.local wins over .env, matching Next.js precedence.
loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

type SeedCompany = {
  name: string;
  domain: string;
  ats_provider: string;
  ats_token: string;
  ats_feed_url: string;
  ats_confidence: number;
  careers_url?: string;
  jobs_total?: number;
  jobs_israel?: number;
  sources?: string[];
};

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Board subdomains are not part of a company's identity: `careers.elementor.com`
 * and `elementor.com` are the same employer, and slugging the first label would
 * name them both "careers".
 */
const BOARD_SUBDOMAINS = new Set([
  "careers", "career", "jobs", "job", "apply", "boards", "board",
  "hire", "hiring", "work", "recruiting", "recruit", "talent", "www",
]);

export function canonicalDomain(input: string): string {
  let host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const labels = host.split(".");
  while (labels.length > 2 && BOARD_SUBDOMAINS.has(labels[0])) labels.shift();
  host = labels.join(".");
  return host;
}

function slugify(domain: string, name: string): string {
  const base = domain ? canonicalDomain(domain).split(".")[0] : name.toLowerCase();
  return (
    base
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "company"
  );
}

/** Slugs are unique in the schema, so collisions get a numeric suffix. */
function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; n < 500; n++) {
    const candidate = base + "-" + n;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error("Cannot allocate a unique slug for " + base);
}

function requireEnv(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key];
    if (value) return value;
  }
  throw new Error(`Missing env var ${name}. Copy .env.example to .env.local and fill it in.`);
}

async function main() {
  const url = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const path = resolve(process.cwd(), "data/companies.seed.json");
  const seed = JSON.parse(await readFile(path, "utf8")) as SeedCompany[];
  console.log(`Loaded ${seed.length} companies from ${path}`);

  // Deduplicate the file itself before touching the database: the seed list is
  // assembled from several enumeration passes and can repeat a domain.
  const byDomain = new Map<string, SeedCompany>();
  for (const c of seed) {
    const domain = c.domain ? canonicalDomain(c.domain) : "";
    if (!domain) continue;
    const existing = byDomain.get(domain);
    if (!existing || (c.jobs_israel ?? 0) > (existing.jobs_israel ?? 0)) {
      byDomain.set(domain, { ...c, domain });
    }
  }
  const companies = [...byDomain.values()];
  if (companies.length !== seed.length) {
    console.log(`Deduplicated to ${companies.length} unique domains`);
  }

  const { data: existingRows, error: readError } = await supabase
    .from("companies")
    .select("id, domain, slug, sources, ats_provider, ats_token, careers_url, next_run_at");
  if (readError) throw readError;

  const existing = new Map(
    (existingRows ?? []).map((r) => [r.domain as string, r]),
  );

  const takenSlugs = new Set<string>(
    (existingRows ?? []).map((r) => r.slug as string).filter(Boolean),
  );

  /*
   * WHEN EACH NEW COMPANY FIRST BECOMES DUE.
   *
   * This used to set `next_run_at` to now for every row, which had two
   * consequences. Seeding a batch made all of them due at the same instant, so
   * the crawler leased and crawled the lot in one burst; and re-running the
   * seeder reset the schedule of every company already in the table, turning a
   * no-op re-seed into a full re-crawl of all of them. The instance is CPU
   * bound and search has gone down for exactly this before.
   *
   * So: an existing company keeps the schedule it already has, and new ones are
   * spread evenly across a window. 90 companies over 48 hours is one new
   * company every 32 minutes, which disappears into the normal crawl load
   * instead of arriving as a spike.
   */
  const STAGGER_HOURS = Number(process.env.SEED_STAGGER_HOURS ?? 48);
  const newDomains = companies.filter((c) => !existing.has(c.domain));
  const stepMs = newDomains.length > 1
    ? (STAGGER_HOURS * 3_600_000) / newDomains.length
    : 0;
  let slot = 0;
  const startedAt = Date.now();

  const rows = companies.map((c) => {
    const prior = existing.get(c.domain);
    const mergedSources = [
      ...new Set([...(prior?.sources ?? []), ...(c.sources ?? ["seed"])]),
    ];
    return {
      slug: prior?.slug ?? uniqueSlug(slugify(c.domain, c.name), takenSlugs),
      name_en: c.name,
      domain: c.domain,
      sources: mergedSources,
      ats_provider: c.ats_provider,
      ats_token: c.ats_token,
      ats_feed_url: c.ats_feed_url,
      ats_confidence: c.ats_confidence,
      // never overwrite a stored non-empty value with an empty incoming one
      careers_url: c.careers_url || prior?.careers_url || null,
      crawl_status: "active" as const,
      next_run_at: prior
        ? (prior.next_run_at as string | null) ?? new Date().toISOString()
        : new Date(startedAt + stepMs * slot++).toISOString(),
    };
  });

  const created = rows.filter((r) => !existing.has(r.domain)).length;
  console.log(
    `${created} new, ${rows.length - created} updated${DRY_RUN ? " (dry run, nothing written)" : ""}`,
  );

  if (DRY_RUN) {
    for (const r of rows.slice(0, 10)) {
      console.log(`  ${r.domain.padEnd(28)} ${r.ats_provider}:${r.ats_token}`);
    }
    return;
  }

  /*
   * Chunked so a large seed list never exceeds the request size limit, and
   * spaced so it never competes with search for CPU. The instance is small and
   * a burst of writes has taken search down before; a second between chunks
   * costs a few seconds on a job nobody is waiting for.
   */
  const CHUNK = 50;
  const PAUSE_MS = Number(process.env.SEED_PAUSE_MS ?? 1000);
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("companies")
      .upsert(chunk, { onConflict: "domain" });
    if (error) throw error;
    written += chunk.length;
    process.stdout.write(`\rUpserted ${written}/${rows.length}`);
    if (i + CHUNK < rows.length) {
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }
  process.stdout.write("\n");

  const { count } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true });
  console.log(`companies table now holds ${count} rows`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
