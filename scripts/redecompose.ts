/**
 * Re-run decomposition over rows that were decided by an older version.
 *
 * ## Why this exists
 *
 * Every decomposition fix so far has reached new postings only. The rule was
 * corrected in code, the tests went green, and the four thousand rows already
 * in the index kept saying whatever the old rule decided — so a search for
 * מעצבת still missed the design jobs, and a senior role read as mid-level
 * stayed mid-level. Fixing a classifier without re-running it changes nothing
 * anybody can see.
 *
 * ## What it will and will not touch
 *
 * ONLY the decomposition columns. Not `status`, not `expires_at`, not
 * `posted_at`, not `content_hash`, not anything a scraper or a campaign owns.
 * A re-decomposition is a re-reading of text that is already stored; it is not
 * a re-import, and it must never be able to close a job or open one.
 *
 * Nothing is written where nothing changed. The comparison is on the
 * decomposition columns only, so a row whose reading is unaffected costs a
 * read and no write at all — which is what makes it safe to run over the whole
 * index on a small instance.
 *
 * ## Pacing
 *
 * Every write rebuilds a generated tsvector behind a GIN index. That is real
 * CPU on an instance shared with live search, and an unpaced bulk update took
 * the site down twice on 2026-09-09. Same rule as the importer: idle for as
 * long as the last write took.
 *
 * ## Usage
 *
 *   pnpm redecompose                         # report only, 500 rows
 *   pnpm redecompose --limit=2000            # report only, more rows
 *   pnpm redecompose --apply                 # write the changes
 *   pnpm redecompose --apply --limit=5000
 *   pnpm redecompose --version=2026-09-07    # only rows at that version
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { DECOMP_VERSION, decompose, normalizeHe } from "@jobsworm/core";

loadEnv({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const LIMIT = Math.max(1, Number(arg("limit") ?? 500));
/*
 * 100, matching UPSERT_CHUNK in the importer.
 *
 * Not a guess: that is the value the ingest loop has been running at since the
 * 2026-09-09 outages without trouble, on the same CPU-starved instance. A
 * bulk rewrite is not the place to try a bigger number.
 */
const CHUNK = 100;

/** Idle for as long as the last write took, within these bounds. */
const PACE_MIN_MS = 150;
const PACE_MAX_MS = 3_000;
const paceAfter = (startedAt: number) =>
  new Promise((r) =>
    setTimeout(r, Math.min(PACE_MAX_MS, Math.max(PACE_MIN_MS, Date.now() - startedAt))),
  );

/**
 * The columns a re-decomposition may write. Everything else is off limits.
 *
 * Written out rather than derived, so adding a field to `DecomposedJob` cannot
 * silently widen what this script is allowed to overwrite.
 */
const DECOMP_COLUMNS = [
  "title_norm",
  "function",
  "sub_function",
  "seniority",
  "req_years_min",
  "req_years_max",
  "employment_type",
  "remote",
  "hybrid_days_office",
  "location",
  "skills_required",
  "skills_nice",
  "tech_stack",
  "languages",
  "education",
  "clearance",
  "lang",
  "quality_flags",
  "decomp_meta",
  "decomp_version",
] as const;

type Row = {
  id: string;
  title_raw: string | null;
  description_text: string | null;
  source_provider: string | null;
  company_name_raw: string | null;
  decomp_version: string | null;
  location: { raw?: string | null } | null;
} & Record<string, unknown>;

function client(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Deep equality for the scalar, array and jsonb columns above.
 *
 * The object branch compares KEY BY KEY rather than by `JSON.stringify`.
 * Stringify was the first version and it reported every single row as changed:
 * Postgres stores jsonb with its own key ordering, so a `location` that came
 * back from the database never serialised identically to the one decompose had
 * just built, even when every value was the same.
 *
 * That is not a cosmetic bug in a reporting script. With `--apply` it would
 * have rewritten all four thousand rows — each one rebuilding a generated
 * tsvector behind a GIN index — which is precisely the write storm that took
 * the site down twice on 2026-09-09, triggered by the tool written to be safe
 * about exactly that.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).filter((k) => (a as never)[k] !== undefined);
    const kb = Object.keys(b as object).filter((k) => (b as never)[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => kb.includes(k) && same((a as never)[k], (b as never)[k]));
  }
  return false;
}

/**
 * Sources whose postings are known to be tech-only.
 *
 * Mirrors `TECH_CONTEXT_SOURCES` in the importer. It matters here because
 * `decompose` uses it to let business-function roles through the 4.5 gate, and
 * re-decomposing with the wrong value would flip the function on rows the
 * importer classified correctly.
 */
const TECH_CONTEXT_SOURCES = new Set(["facebook", "linkedin", "revhub"]);

async function main() {
  const supabase = client();
  const onlyVersion = arg("version");

  /*
   * Read in pages of 1000.
   *
   * PostgREST caps a single response at 1000 rows whatever `range` asks for,
   * so a bare `--limit=6000` silently read a quarter of the index and reported
   * on that as though it were the whole thing. Paging explicitly is the
   * difference between "280 rows differ" and "280 rows of the first thousand
   * differ", which are not the same claim.
   *
   * Ordered by id so the pages partition the set rather than overlapping, and
   * read to completion BEFORE anything is written — writing mid-scan would
   * change the filter under the offsets.
   */
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let from = 0; from < LIMIT; from += PAGE) {
    let query = supabase
      .from("jobs")
      .select(
        "id, title_raw, description_text, source_provider, company_name_raw, decomp_version, location, title_norm, function, sub_function, seniority, req_years_min, req_years_max, employment_type, remote, hybrid_days_office, skills_required, skills_nice, tech_stack, languages, education, clearance, lang, quality_flags",
      )
      .eq("status", "open")
      .order("id", { ascending: true })
      .range(from, Math.min(from + PAGE, LIMIT) - 1);

    query = onlyVersion
      ? query.eq("decomp_version", onlyVersion)
      : // `or` rather than `neq`: a NULL decomp_version is not "different from"
        // the current one as far as SQL is concerned, and those are exactly the
        // oldest rows.
        query.or(`decomp_version.is.null,decomp_version.neq.${DECOMP_VERSION}`);

    const { data, error } = await query;
    if (error) {
      console.error("select failed:", error.message);
      process.exit(1);
    }
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  console.log(`\n  ${rows.length} row(s) below version ${DECOMP_VERSION}\n`);
  if (!rows.length) return;

  const updates: Array<Record<string, unknown>> = [];
  const changedFields = new Map<string, number>();
  let unchanged = 0;

  for (const row of rows) {
    const title = row.title_raw ?? "";
    const body = row.description_text ?? "";
    if (!title && !body) continue;

    const source = row.source_provider ?? "unknown";
    const d = decompose({
      titleRaw: title,
      descriptionText: body,
      locationRaw: row.location?.raw ?? null,
      companyName: row.company_name_raw ?? null,
      techContext: TECH_CONTEXT_SOURCES.has(source),
      source,
    });

    const next: Record<string, unknown> = {
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
      lang: d.lang,
      quality_flags: d.qualityFlags,
      decomp_version: d.decompVersion,
    };

    /*
     * `description_norm` is re-derived rather than re-read: it is
     * normalize_he(description_text), it feeds the generated tsvector, and a
     * row whose normaliser has changed since it was written would otherwise
     * keep a stale search vector forever.
     */
    const normalised = normalizeHe(body);

    const diff: string[] = [];
    for (const col of DECOMP_COLUMNS) {
      if (col === "decomp_meta" || col === "decomp_version") continue;
      if (!same(row[col], next[col])) diff.push(col);
    }

    /*
     * A row whose READING is unchanged is not written, even though its
     * `decomp_version` is stale.
     *
     * Stamping it would be bookkeeping, and there is no cheap way to do it:
     * `jobs.search_tsv` is a STORED generated column, so an UPDATE to any
     * column re-evaluates it and rewrites every GIN index entry. Writing four
     * thousand rows to record that nothing about them changed is exactly the
     * write storm this script exists to avoid.
     *
     * The cost is that those rows are re-read on every later pass. That is one
     * SELECT over a few thousand rows, which is nothing next to the writes.
     */
    if (!diff.length) {
      unchanged++;
      continue;
    }

    for (const f of diff) changedFields.set(f, (changedFields.get(f) ?? 0) + 1);
    updates.push({ id: row.id, ...next, decomp_meta: d.decompMeta, description_norm: normalised });
  }

  console.log(`  ${updates.length} row(s) read differently now`);
  console.log(`  ${unchanged} row(s) read the same, so they are left alone
`);
  if (changedFields.size) {
    for (const [field, n] of [...changedFields].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(5)}  ${field}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("  Report only. Pass --apply to write.\n");
    return;
  }

  let written = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const at = Date.now();
    const batch = updates.slice(i, i + CHUNK);
    /*
     * `upsert` on the primary key, so this is an UPDATE of exactly these
     * columns. It cannot insert: every row carries an `id` that already
     * exists, and the columns a new row would need are not here.
     */
    /*
     * `update`, one row at a time — NOT `upsert`.
     *
     * The first version used `upsert(batch, { onConflict: "id" })`, which
     * reads like a batched update and is not one: PostgREST validates an
     * upsert payload as an INSERT, so it rejected the whole batch for a
     * missing `source_provider` — a column this script has no business
     * sending, because it has no business changing it.
     *
     * An UPDATE keyed on the id can only touch the columns named, which is
     * exactly the guarantee the header promises. The cost is a round trip per
     * row, and the pacing below already assumed writes would be the slow part.
     */
    for (const row of batch) {
      const { id, ...cols } = row as { id: string } & Record<string, unknown>;
      const { error: writeError } = await supabase.from("jobs").update(cols).eq("id", id);
      if (writeError) {
        console.error(`  row ${id} failed:`, writeError.message);
        process.exit(1);
      }
      written++;
    }

    console.log(`  ${written}/${updates.length}`);
    await paceAfter(at);
  }
  console.log(`\n  wrote ${written} row(s)\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
