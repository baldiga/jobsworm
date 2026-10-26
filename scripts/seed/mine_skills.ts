/**
 * mine_skills.ts — find the skills our own job corpus asks for and our
 * dictionary does not know.
 *
 * ## Why not a public taxonomy
 *
 * The obvious move is to import ESCO, and it was tried first. ESCO is free for
 * any purpose under Commission Decision 2011/833/EU, has 13,939 skills, and is
 * the wrong shape for this job:
 *
 *   - Its labels are occupational-standard VERB PHRASES, not CV words. The
 *     entry for payroll is "manage payroll", and all four of its alternative
 *     labels are "oversee/handle/managing/administer payroll". None of them is
 *     "payroll", which is the word on the CV.
 *   - Skills are bound to occupations, so "performance management" exists only
 *     as an alias of "manage truck drivers" — an entry that would actively
 *     mis-tag a CV.
 *   - Acronyms are missing. It has "international financial reporting
 *     standards" and not IFRS; CVs write IFRS.
 *   - Modern tech-adjacent vocabulary is simply absent: no talent acquisition,
 *     no demand generation, no internal controls in the sense fintech uses.
 *
 * And it has no Hebrew at all, which rules it out for half our text.
 *
 * ## What this does instead
 *
 * The best description of the skills an Israeli tech employer wants is the
 * 4,500 Israeli tech job ads we already hold. Frequency alone is useless —
 * the top terms are "engineering", "looking", "description" — so this reads
 * POSITION rather than count: the words that follow "experience with",
 * "knowledge of", "ניסיון ב" and their kin. In that position, 274 of the terms
 * found are already in the dictionary, which is the check that the extraction
 * is aimed correctly.
 *
 * It surfaced `langgraph` in 11 live listings. That is the whole argument for
 * mining over importing: a framework younger than any taxonomy's release
 * cycle, wanted by eleven employers here, that ESCO will never carry.
 *
 * ## Jobs only, never CVs
 *
 * The 800 stored CVs would be a second corpus and this deliberately does not
 * read them. A job ad is published to be read; a CV is consented personal data
 * held for matching, and "we mined your CV to improve our dictionary" is not a
 * purpose anyone agreed to. Job ads answer the same question.
 *
 * ## Output is a proposal, not a change
 *
 * Writes a ranked candidate list for a human to accept or reject. Adding a bad
 * term is not free: the dictionary drives what a seeker is matched on, so
 * "data" or "english" as a skill would quietly degrade every match. The noise
 * in the output is left visible rather than guessed at.
 *
 *   pnpm tsx scripts/seed/mine_skills.ts --min-jobs 8 --out data/skill_candidates.json
 */

import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { SKILL_INDEX } from "../../packages/core/src/data/skills";

function arg(name: string, fallback?: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

/**
 * Phrases that introduce a skill, in both languages the corpus is written in.
 *
 * This is the whole trick. A job ad says "experience with Kubernetes", and the
 * word after that phrase is a skill far more often than any frequent word is.
 */
const TRIGGER =
  /(?:experience (?:with|in|using)|proficien(?:cy|t) (?:in|with)|knowledge of|familiarity with|hands[- ]on (?:with|experience with)?|expertise in|background in|skills? in|working (?:with|knowledge of)|understanding of|ניסיון ב|ניסיון עם|ידע ב|שליטה ב|היכרות עם)\s+/gi;

/**
 * Words that are never a skill on their own.
 *
 * Deliberately broad. A false negative costs one term a human could add by
 * hand; a false positive puts a word like "team" into the matcher, where it
 * fires on every listing and quietly poisons matching for everybody.
 */
const STOP = new Set(
  `a an the and or of in on for with to at by from as is are be been being this that these those our your their its it we you they i
  building build develop developing development design designing work working works environment environments team teams product products
  project projects company companies business customer customers user users people world global leading modern complex large scale
  new other others such including include includes etc via per each same own least most more some all any both two one three
  strong excellent proven deep solid good great high highly very ability able understanding knowledge experience expertise familiarity
  background skills skill hands field area areas tools technologies technology systems system plus advantage must required requirement
  requirements responsibilities role position job candidate candidates who what how why when where which while than then
  english hebrew arabic russian french spanish`.split(/\s+/),
);

/*
 * `english` and `hebrew` are in STOP on purpose, and they were the two most
 * frequent findings — 67 and 24 listings. They are real requirements and they
 * are NOT skills: the schema has a `languages` field for exactly this, and
 * putting them in the skill dictionary would tag most of the index with them.
 * Worth wiring into language extraction separately; wrong here.
 */

function cleanTerm(raw: string): string | null {
  let t = raw.toLowerCase().trim();
  // Take the head of the phrase: a trigger is usually followed by a list.
  t = t.split(/[,.;:!?()[\]{}"']|\s+[-–—]\s+|\band\b|\bor\b|\bwith\b/)[0];
  t = t.replace(/^[^a-z0-9֐-׿]+|[^a-z0-9+#֐-׿]+$/g, "").trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return null;
  if (words.every((w) => STOP.has(w))) return null;
  if (words.length === 1 && STOP.has(words[0])) return null;
  if (t.length < 2 || t.length > 32) return null;
  if (/^\d/.test(t)) return null;
  return t;
}

async function main() {
  const minJobs = Number(arg("min-jobs", "8"));
  const out = arg("out", "data/skill_candidates.json");

  const supabase = createClient(
    (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const rows: { title_raw: string | null; description_text: string | null }[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await supabase
      .from("jobs")
      .select("title_raw, description_text")
      .eq("status", "open")
      .not("description_text", "is", null)
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  // Counted in JOBS, not occurrences: one ad repeating "Kubernetes" nine times
  // is one employer wanting it, not nine.
  const seenIn = new Map<string, Set<number>>();
  const example = new Map<string, string>();

  rows.forEach((row, idx) => {
    const text = row.description_text ?? "";
    for (const m of text.matchAll(TRIGGER)) {
      const tail = text.slice(m.index! + m[0].length, m.index! + m[0].length + 60);
      const term = cleanTerm(tail);
      if (!term) continue;
      let set = seenIn.get(term);
      if (!set) seenIn.set(term, (set = new Set()));
      set.add(idx);
      if (!example.has(term)) example.set(term, (row.title_raw ?? "").slice(0, 60));
    }
  });

  const all = [...seenIn.entries()].map(([term, set]) => ({ term, jobs: set.size }));
  const known = all.filter((c) => SKILL_INDEX.has(c.term));
  const candidates = all
    .filter((c) => !SKILL_INDEX.has(c.term) && c.jobs >= minJobs)
    .sort((a, b) => b.jobs - a.jobs)
    .map((c) => ({ ...c, seenOn: example.get(c.term) ?? "" }));

  await writeFile(
    out,
    JSON.stringify(
      {
        generated_at: new Date().toISOString().slice(0, 10),
        jobs_scanned: rows.length,
        known_terms_found: known.length,
        min_jobs: minJobs,
        note:
          "Candidates only. Mined from open job ads by position, not frequency. " +
          "A human accepts or rejects each: a wrong term degrades matching for everyone.",
        candidates,
      },
      null,
      1,
    ) + "\n",
    "utf8",
  );

  console.log(`jobs scanned              : ${rows.length}`);
  console.log(`terms in a skill position : ${all.length}`);
  console.log(`  already in the dictionary: ${known.length}  <- extraction is aimed right`);
  console.log(`CANDIDATES (>=${minJobs} jobs)      : ${candidates.length}`);
  console.log(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
