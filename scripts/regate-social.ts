/**
 * regate-social.ts — re-run the non-vacancy gate over social posts already in
 * the index, and close the ones it would reject today.
 *
 * ## Why this is needed at all
 *
 * The gate has grown: seekers, then freelance ads, discussions and course ads,
 * and today classified ads. Every improvement applied only to posts arriving
 * afterwards. Nothing has ever gone back over what was already stored, so the
 * index still holds posts that the current code would never have let in.
 *
 * Found by sampling the live index on 2026-09-14: "מחפשת עבודה שווה" and
 * "מחפשת עבודה עם משמעות" are both open listings, and `judgeSeekerPost` on
 * each returns kind="seeker" — the gate catches them now, they simply arrived
 * before it could.
 *
 * ## Only social sources
 *
 * A board or an ATS feed does not carry somebody's availability post or an
 * advert for a flat, and the gate was never meant for them. Running it over
 * ATS rows would risk closing real vacancies to fix a problem they do not
 * have.
 *
 * ## Closed, not deleted
 *
 * Same as every other close in this schema: reversible, keeps an application
 * someone already made resolvable, and search filters on status anyway. The
 * reason is recorded in quality_flags so a mistake is auditable and a later
 * run can find them again.
 *
 *   pnpm tsx scripts/regate-social.ts            # dry run, reports only
 *   pnpm tsx scripts/regate-social.ts --apply
 */

import { createClient } from "@supabase/supabase-js";
import { judgeSeekerPost } from "@jobsworm/core";

const APPLY = process.argv.includes("--apply");
const SOCIAL = ["facebook", "linkedin", "secrettelaviv"];

function env(name: string, ...fallbacks: string[]): string {
  for (const n of [name, ...fallbacks]) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`missing ${name}`);
}

async function main() {
  const supabase = createClient(
    env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const PAGE = 1000;
  let from = 0;
  const doomed: { id: string; title: string; kind: string; matched: string | null }[] = [];
  let scanned = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, title_raw, excerpt, description_text")
      .eq("status", "open")
      .in("source_provider", SOCIAL)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;

    for (const row of data) {
      scanned++;
      /*
       * Title plus the opening of the body, which is what the gate is built
       * for — it reads the first 400 characters and says so. Passing the whole
       * description would feed it comments and signatures.
       */
      const text = [row.title_raw, row.excerpt ?? row.description_text ?? ""]
        .filter(Boolean)
        .join("\n");
      const v = judgeSeekerPost(text);
      if (v.isSeeker && v.kind) {
        doomed.push({
          id: row.id as string,
          title: String(row.title_raw ?? "").slice(0, 56),
          kind: v.kind,
          matched: v.matched ? String(v.matched).slice(0, 46) : null,
        });
      }
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  const byKind = doomed.reduce<Record<string, number>>((acc, d) => {
    acc[d.kind] = (acc[d.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`scanned open social listings : ${scanned}`);
  console.log(`would close                  : ${doomed.length}`);
  console.log(`  by kind                    :`, byKind);
  console.log("");
  for (const d of doomed.slice(0, 40)) {
    console.log(`  ${d.kind.padEnd(14)} ${d.title}`);
  }
  if (doomed.length > 40) console.log(`  … and ${doomed.length - 40} more`);

  if (!APPLY) {
    console.log("\n(dry run — pass --apply to close them)");
    return;
  }

  /*
   * Flagged with the reason it was rejected, not with `dead_link`.
   *
   * The first version called `close_dead_jobs`, which is the link checker's
   * RPC and stamps `dead_link` on everything. That was wrong twice over: the
   * link was fine, and the import now refuses to reopen a post whose
   * quality_flags say it was rejected — so the flag is load-bearing, and
   * recording "seeker" as "dead_link" would make the audit trail lie about
   * why a post is gone.
   */
  const CHUNK = 50;
  let done = 0;
  for (const kind of Object.keys(byKind)) {
    const ids = doomed.filter((d) => d.kind === kind).map((d) => d.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("jobs")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          quality_flags: [kind],
        })
        .in("id", slice);
      if (error) throw error;
      done += slice.length;
      process.stdout.write(`\rclosed ${done}/${doomed.length}`);
      // A write burst against a small instance is what takes search down.
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log("\ndone");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
