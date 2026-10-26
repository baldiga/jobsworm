import { NextResponse } from "next/server";
import { createActionClient } from "@/lib/supabase";

const REGIONS = new Set([
  "tel_aviv", "center", "sharon", "shfela", "jerusalem", "haifa", "north", "south",
]);
const SENIORITY = new Set(["student", "junior", "mid", "senior", "lead", "manager", "director", "exec"]);
const REMOTE = new Set(["onsite", "hybrid", "remote"]);

/** Same enum as jobs.function. The classifier guesses it; the user owns it. */
const FUNCTIONS = new Set([
  "software_engineering", "data", "devops", "qa", "security", "it_support",
  "product", "design", "hardware", "ai_ml", "tech_pm", "technical_writing",
  "solutions_engineering", "sales", "marketing", "customer_success",
  "finance", "hr", "operations", "legal",
]);

function cleanList(value: unknown, max = 60, allowed?: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    const s = String(v).trim().toLowerCase();
    if (!s || s.length > 60) continue;
    if (allowed && !allowed.has(s)) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export async function POST(request: Request) {
  const supabase = await createActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: "auth" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const seniority = String(body.seniority ?? "").toLowerCase();
  const headline = typeof body.headline === "string" ? body.headline.trim().slice(0, 120) : null;

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      headline: headline || null,
      // Free text, so it is bounded and lowercased rather than trusted.
      skills: cleanList(body.skills),
      preferred_titles: cleanList(body.preferred_titles, 8),
      regions: cleanList(body.regions, 8, REGIONS),
      /*
       * Seniority, field and work setup are multi-select, like regions.
       * Requested: "I may want to choose Mid-Level, Senior and Manager, same
       * should be enabled in 'your field' and 'work setup'". See
       * 0030_profile_multi_select.sql.
       *
       * This is also where "Save failed. Please try again." came from. The
       * work setup used to be written to `hybrid_tolerance`, an int 0-7
       * counting office days, as the string 'onsite' | 'hybrid' | 'remote':
       *
       *     invalid input syntax for type integer: "hybrid"
       *
       * One upsert, so the type error aborted the whole statement — choosing a
       * work setup did not merely fail to save, it took the regions, seniority
       * and skills edits down with it. True for every one of the 332 profiles;
       * not one had ever saved a work setup.
       */
      seniority_levels: cleanList(body.seniority_levels, 8, SENIORITY),
      job_functions: cleanList(body.job_functions, 8, FUNCTIONS),
      remote_prefs: cleanList(body.remote_prefs, 3, REMOTE),
      /*
       * The single columns stay in step with the arrays. `seniority` and
       * `job_function` are read by code and by the CV parser that has not moved
       * to the arrays, so leaving them stale would make a profile disagree with
       * itself. First choice wins, since the chips are rendered in a fixed
       * order and the first is the lowest level / primary field.
       */
      seniority: SENIORITY.has(seniority)
        ? seniority
        : (cleanList(body.seniority_levels, 8, SENIORITY)[0] ?? null),
      job_function: FUNCTIONS.has(String(body.job_function ?? ""))
        ? String(body.job_function)
        : (cleanList(body.job_functions, 8, FUNCTIONS)[0] ?? null),
      /*
       * Years, and whether a person has actually looked at what we read.
       *
       * `years_experience` was written by the CV route and by nothing else, so
       * a figure the parser got wrong could be seen on screen and not
       * corrected. It is bounded rather than trusted: 0-60, whole years.
       *
       * `cv_reviewed_at` is the difference between "we guessed this" and "they
       * confirmed it", and only the second is worth treating as fact. Set only
       * when the client says the person pressed the confirm button — a
       * profile save that happens to include the field does not count as a
       * review.
       */
      ...(typeof body.years_experience === "number" && Number.isFinite(body.years_experience)
        ? { years_experience: Math.max(0, Math.min(60, Math.round(body.years_experience))) }
        : {}),
      ...(body.reviewed === true ? { cv_reviewed_at: new Date().toISOString() } : {}),
    },
    { onConflict: "user_id" },
  );

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
