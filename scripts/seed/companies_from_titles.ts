/**
 * companies_from_titles.ts — decide which employers in a job-title export are
 * hi-tech companies worth crawling, and emit them as candidates.
 *
 * ## What this is for
 *
 * A list of job titles and company names, with no links and no descriptions.
 * We take the company names, and nothing else: the listings themselves are not
 * ours to use, and the point of the exercise is to find the employer's own
 * board and read the job from there.
 *
 * ## The filter is per COMPANY, not per row
 *
 * The instruction was to drop non-hi-tech while keeping accounting, tax, sales,
 * marketing and engineering. Those two only sound contradictory: an accountant
 * at Wiz is a hi-tech job and an accountant at a hotel chain is not, and the
 * title alone cannot tell them apart. `isTech` in the core package already
 * encodes exactly that rule — a business function passes when the employer is
 * a tech company — so the question to answer is about the employer.
 *
 * So: classify every title the company posted with the same classifier the
 * ingest uses, and keep the company if it posted at least one TECH-function
 * role. A company advertising two backend engineers and a tax manager is a tech
 * employer and all three are in scope. A tour operator advertising an
 * operations coordinator posted no tech role at all and is out.
 *
 * ## Agencies are dropped
 *
 * The home page promises organic results are agency-free, and the biggest
 * posters in a list like this are always staffing firms — Gotfriends, SQLink,
 * comblack, Mertens. They post other companies' jobs, so crawling their board
 * would fill the index with exactly what we promise not to carry. Same
 * `looksLikeAgency` the decomposer uses.
 *
 *   pnpm tsx scripts/seed/companies_from_titles.ts --csv in.csv --out out.txt
 */

import { readFile, writeFile } from "node:fs/promises";
import { classifyFunction, looksLikeAgency, normalizeTitle } from "@jobsworm/core";
import { TECH_FUNCTIONS } from "@jobsworm/core";

function arg(name: string, fallback?: string): string {
  const hit = process.argv.find((a) => a.startsWith("--" + name + "="));
  if (hit) return hit.slice(name.length + 3);
  const idx = process.argv.indexOf("--" + name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

/** Minimal RFC4180 reader: the export has quoted commas and newlines in titles. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (c === "\r") continue;
    cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

type Agg = { total: number; tech: number; agency: boolean; sample: string[] };

async function main() {
  const csvPath = arg("csv");
  const outPath = arg("out");
  const minTech = Number(arg("min-tech", "1"));

  const raw = await readFile(csvPath, "utf8");
  const rows = parseCsv(raw.replace(/^﻿/, ""));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iTitle = header.indexOf("title");
  const iCompany = header.indexOf("company");
  if (iTitle < 0 || iCompany < 0) throw new Error("need Title and Company columns");

  const byCompany = new Map<string, Agg>();

  for (const row of rows.slice(1)) {
    const title = (row[iTitle] ?? "").trim();
    const company = (row[iCompany] ?? "").trim();
    if (!title || !company) continue;

    let agg = byCompany.get(company);
    if (!agg) {
      agg = { total: 0, tech: 0, agency: false, sample: [] };
      byCompany.set(company, agg);
    }
    agg.total++;

    /*
     * The title is all we have. The classifier normally sees a description
     * too, so pass the title as both — it lowers confidence but the cue
     * matching is the same, and a title is what a human would judge from here.
     */
    const norm = normalizeTitle(title);
    const { fn } = classifyFunction(norm, title);
    if (TECH_FUNCTIONS.has(fn)) {
      agg.tech++;
      if (agg.sample.length < 3) agg.sample.push(title.slice(0, 60));
    }
    // One agency signal anywhere is enough; these firms name themselves.
    if (!agg.agency && looksLikeAgency(title, company)) agg.agency = true;
  }

  const all = [...byCompany.entries()];
  const agencies = all.filter(([, a]) => a.agency);
  const keep = all
    .filter(([, a]) => !a.agency && a.tech >= minTech)
    .sort((a, b) => b[1].tech - a[1].tech);
  const dropped = all.filter(([, a]) => !a.agency && a.tech < minTech);

  const lines = [
    "# Employers from a job-title export. Company names only — no listing",
    "# content, no links. Kept when the company posted at least one tech-function",
    "# role, per packages/core TECH_FUNCTIONS; agencies dropped.",
    "# Format:  Name | domain   (domain resolved separately)",
    "",
  ];
  for (const [name, a] of keep) lines.push(`${name}\t${a.tech}\t${a.total}`);
  await writeFile(outPath, lines.join("\n") + "\n", "utf8");

  console.log(`rows                 : ${rows.length - 1}`);
  console.log(`distinct companies   : ${all.length}`);
  console.log(`  agencies dropped   : ${agencies.length}`);
  console.log(`  no tech role       : ${dropped.length}`);
  console.log(`  KEPT               : ${keep.length}`);
  console.log("");
  console.log("largest kept:");
  for (const [name, a] of keep.slice(0, 12)) {
    console.log(`  ${String(a.tech).padStart(4)} tech / ${String(a.total).padStart(4)} total  ${name}`);
  }
  console.log("");
  console.log("agencies dropped (top):");
  for (const [name, a] of agencies.sort((x, y) => y[1].total - x[1].total).slice(0, 10)) {
    console.log(`  ${String(a.total).padStart(4)} posts  ${name}`);
  }
  console.log("");
  console.log("dropped as non-tech (sample):");
  for (const [name, a] of dropped.slice(0, 10)) console.log(`  ${a.total} posts  ${name}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
