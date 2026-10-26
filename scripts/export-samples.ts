import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

/**
 * Dumps a sample of jobs to JSONL for the Claude Code labeling sessions
 * described in PLAN.md section 13.
 */
async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");

  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 300);
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await supabase
    .from("jobs")
    .select("id, title_raw, company_id, description_text, source_provider, location, status")
    .order("first_seen_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const outDir = resolve(process.cwd(), "data/samples");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "jobs.jsonl");
  writeFileSync(
    outFile,
    (data ?? [])
      .map((row) =>
        JSON.stringify({
          id: row.id,
          title_raw: row.title_raw,
          company: row.company_id,
          description_text: (row.description_text ?? "").slice(0, 6000),
          source: row.source_provider,
        }),
      )
      .join("\n") + "\n",
    "utf8",
  );

  console.log(`Wrote ${data?.length ?? 0} jobs to ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
