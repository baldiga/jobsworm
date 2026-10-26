/**
 * One report over everything the live index has been debugged for.
 *
 *   pnpm tsx scripts/audit-index.ts            # report only
 *   pnpm tsx scripts/audit-index.ts --apply    # also hide what it finds
 *
 * Every check here exists because something was wrong on the site and somebody
 * reported it. The gates that fix them all run at IMPORT time, which means
 * widening a gate fixes tomorrow's rows and leaves today's exactly where they
 * are — so this re-runs them against what is already stored.
 *
 * `--apply` hides rows with `status='draft'` and a quality flag. Never
 * `closed`: closed tells a reader the job ended, and none of these ended —
 * they were either never jobs, or never ours to publish. Draft is invisible
 * through RLS the moment it is written and reverses with one UPDATE.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { judgeSeekerPost, resolveLocation, type NonVacancyKind } from "@jobsworm/core";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

const APPLY = process.argv.includes("--apply");
const PAGE = 1000;

/**
 * Sources whose terms forbid republishing. Keep in step with WITHHELD_SOURCES
 * in packages/adapters/src/import-scraped.ts: this copy used to list three of
 * the five, so the audit could not see the other two.
 */
const WITHHELD = ["alljobs", "drushim", "yad2", "secrettelaviv", "linkedin"];
/** Sources whose rows are posts by people, so the non-vacancy gate applies. */
const SOCIAL = ["facebook", "linkedin", "revhub"];

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Row = {
  id: string;
  title_raw: string | null;
  description_text: string | null;
  source_provider: string;
  location: { country?: string | null; city?: string | null; raw?: string | null } | null;
  is_agency: boolean | null;
  remote: string | null;
  posted_at: string | null;
  first_seen_at: string | null;
  quality_flags: string[] | null;
};

const SELECT =
  "id, title_raw, description_text, source_provider, location, is_agency, remote, posted_at, first_seen_at, quality_flags";

async function allOpen(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("jobs")
      .select(SELECT)
      .eq("status", "open")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type Finding = { row: Row; flag: string; detail: string };

function monthsOld(row: Row): number {
  const when = row.posted_at ?? row.first_seen_at;
  if (!when) return 0;
  return (Date.now() - new Date(when).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

async function main() {
  const rows = await allOpen();
  console.log(`open jobs in the index: ${rows.length}\n`);

  const findings: Finding[] = [];
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

  // ---- 1. Sources we are not permitted to publish -------------------------
  for (const row of rows) {
    if (WITHHELD.includes(row.source_provider)) {
      findings.push({ row, flag: "source_withheld", detail: row.source_provider });
      bump("withheld source");
    }
  }

  // ---- 2/3/4/5. Posts that are not vacancies ------------------------------
  // Seeker, freelance advert, group question, course advert.
  const kinds: Record<string, number> = {};
  for (const row of rows) {
    if (!SOCIAL.includes(row.source_provider)) continue;
    const verdict = judgeSeekerPost(
      [row.title_raw ?? "", row.description_text ?? ""].join("\n"),
    );
    if (!verdict.isSeeker || !verdict.kind) continue;
    const kind = verdict.kind as NonVacancyKind;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    findings.push({ row, flag: `not_a_vacancy:nv_${kind}`, detail: kind });
    bump("not a vacancy");
  }

  /*
   * ---- 6. Jobs outside Israel ---------------------------------------------
   *
   * The resolver is re-run rather than `location.country` being read, and the
   * difference is not academic: this check used to trust the stored country
   * and reported a confident zero while 332 foreign jobs sat in the index.
   *
   * `country` is set to IL by default when no Israeli city can be found, so a
   * posting whose only stated location is "EMEA", "Austin" or "Bogotá, Bogota,
   * Colombia" was stored as Israeli. Worse, "US-IL-Chicago" — Illinois — reads
   * as Israel to anything matching on the country code alone.
   *
   * A stored field cannot audit the code that wrote it. Re-deriving is the
   * only version of this check that can fail.
   */
  for (const row of rows) {
    const raw = row.location?.raw ?? null;
    const { location } = resolveLocation(raw, row.description_text ?? "", row.title_raw ?? "");
    if (location.abroad) {
      findings.push({ row, flag: "abroad", detail: String(raw ?? "").slice(0, 60) });
      bump("abroad");
    }
  }

  // ---- 7. Agencies (stored, but must be flagged so search can hide them) --
  const agencies = rows.filter((r) => r.is_agency).length;

  // ---- 8. Stale postings --------------------------------------------------
  // Not auto-hidden: an evergreen ATS req can be genuinely open for years.
  // Reported so the decision stays a person's.
  const stale = rows.filter((r) => monthsOld(r) > 12);
  const veryStale = rows.filter((r) => monthsOld(r) > 24);

  // ---- report -------------------------------------------------------------
  console.log("PROBLEMS THAT SHOULD BE ZERO");
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n === 0 ? "OK  " : "FAIL"}  ${k.padEnd(18)} ${n}`);
  }
  if (!Object.keys(counts).length) console.log("  OK    nothing found");
  if (Object.keys(kinds).length) {
    console.log(
      "        of which: " +
        Object.entries(kinds)
          .map(([k, n]) => `${k}=${n}`)
          .join(" "),
    );
  }

  console.log("\nFOR INFORMATION");
  console.log(`  agencies flagged (hidden from search): ${agencies}`);
  console.log(`  open and older than 12 months:         ${stale.length}`);
  console.log(`  open and older than 24 months:         ${veryStale.length}`);
  if (veryStale.length) {
    for (const r of veryStale.slice(0, 6)) {
      console.log(
        `     ${String(r.posted_at ?? r.first_seen_at).slice(0, 10)}  ` +
          `${r.source_provider.padEnd(15)} ${(r.title_raw ?? "").slice(0, 46)}`,
      );
    }
  }

  const bySource: Record<string, number> = {};
  for (const f of findings) bySource[f.row.source_provider] = (bySource[f.row.source_provider] ?? 0) + 1;
  if (findings.length) {
    console.log("\n  findings by source: " + Object.entries(bySource).map(([k, n]) => `${k}=${n}`).join(" "));
  }

  if (!APPLY) {
    console.log(`\n${findings.length} row(s) would be hidden. Pass --apply to write.`);
    for (const f of findings.slice(0, 20)) {
      console.log(`  [${f.flag}] ${(f.row.title_raw ?? "").replace(/\s+/g, " ").slice(0, 70)}`);
    }
    return;
  }

  // Paced: this instance is CPU-starved, and an unpaced bulk update is the
  // exact shape that took search down on 2026-09-09.
  let done = 0;
  for (const f of findings) {
    const flags = new Set(f.row.quality_flags ?? []);
    for (const part of f.flag.split(":")) flags.add(part);
    const { error } = await db
      .from("jobs")
      .update({ status: "draft", quality_flags: [...flags] })
      .eq("id", f.row.id);
    if (error) throw new Error(`${f.row.id}: ${error.message}`);
    done += 1;
    if (done % 25 === 0) {
      console.log(`  hidden ${done}/${findings.length}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  console.log(`\nhidden ${done} row(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
