/**
 * Imports scraped postings into `jobs`.
 *
 *   pnpm import:scraped
 *   pnpm import:scraped --sources=workable --since=72
 *   pnpm import:scraped --dry-run
 *   pnpm import:scraped --fail-on-empty     # exit 2 if nothing was scraped
 */

import { config } from "dotenv";
import { importScraped } from "./import-scraped";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a === "--" + name || a.startsWith("--" + name + "="));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}

async function main() {
  const sources = flag("sources");
  const since = flag("since");

  const summaries = await importScraped({
    sources: sources ? sources.split(",") : undefined,
    sinceHours: since ? Number(since) : undefined,
    dryRun: flag("dry-run") !== undefined,
    onProgress: (line) => console.log(line),
  });

  const total = summaries.reduce((n, s) => n + s.imported, 0);
  const candidates = summaries.reduce((n, s) => n + s.candidates, 0);
  console.log("");
  console.log("imported total " + total);

  /*
   * One machine-readable line, so a workflow does not have to parse prose.
   */
  console.log(
    "SUMMARY " +
      JSON.stringify({
        candidates,
        imported: total,
        skippedUnchanged: summaries.reduce((n, s) => n + s.skippedUnchanged, 0),
        sources: Object.fromEntries(summaries.map((s) => [s.source, s.candidates])),
      }),
  );

  /*
   * Zero WRITTEN is healthy — it means every posting we found was already in
   * the index unchanged, which is the normal state of a well-fed importer.
   * Zero SCRAPED across every source is a dead pipeline: an expired cookie, a
   * changed layout, a scraper step that silently failed before this ran. The
   * two look identical in the logs, which is how the pipeline stayed dead for
   * two days without anyone noticing.
   */
  if (flag("fail-on-empty") !== undefined && summaries.length > 0 && candidates === 0) {
    console.error(
      "FAIL: every source returned 0 candidates. Nothing was scraped — check the " +
        "scraper steps that ran before this, not the importer.",
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
