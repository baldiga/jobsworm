/**
 * Ingestion CLI.
 *
 *   pnpm ingest:once                     one pass over the due companies
 *   pnpm ingest:once --limit=200         raise the company cap
 *   pnpm ingest:once --company=wix.com   force one company, ignoring its lease
 *   pnpm ingest:once --dry-run           fetch and decompose, write nothing
 */

import { config } from "dotenv";
import { runIngestPass } from "./ingest";

// `.env.local` holds the real keys and is git-ignored; `.env` is the fallback.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a === "--" + name || a.startsWith("--" + name + "="));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}

async function main() {
  const limitRaw = flag("limit");
  const budgetRaw = flag("budget");

  const summary = await runIngestPass({
    limit: limitRaw ? Number(limitRaw) : 40,
    budgetMs: budgetRaw ? Number(budgetRaw) * 1000 : 15 * 60 * 1000,
    companyDomain: flag("company") || undefined,
    dryRun: flag("dry-run") !== undefined,
    maxJobsPerCompany: 400,
    onProgress: (line) => console.log(line),
  });

  console.log("");
  console.log("companies   " + summary.companies);
  console.log("fetched     " + summary.fetched);
  console.log("kept        " + summary.upserted);
  console.log("unchanged   " + summary.skippedUnchanged);
  console.log("closed      " + summary.closed);
  console.log("non-tech    " + summary.droppedNonTech);
  console.log("abroad      " + summary.droppedAbroad);
  console.log("failed      " + summary.failed);
  console.log("elapsed     " + Math.round(summary.ms / 1000) + "s");

  if (summary.failed) {
    console.log("");
    console.log("failures:");
    for (const r of summary.results.filter((x) => x.error)) {
      console.log("  " + r.company + " [" + r.provider + "] " + r.error);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
