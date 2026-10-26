/**
 * Turning a match score into something a person can act on.
 *
 * ## One negative. Exactly one.
 *
 * A match card that lists every gap is a rejection letter. A reader looking at
 * ten of them stops reading, and the honest ones and the hopeless ones look
 * identical — both are a wall of red.
 *
 * So `explainMatch` returns as many positives as apply and **at most one**
 * negative, chosen by which gap actually decides the outcome. The priority
 * order below is not arbitrary; it is roughly how expensive each gap is to the
 * person reading:
 *
 *   1. Seniority. Reported, in as many words: a junior being shown team-lead
 *      roles. It is the gap that wastes a whole application.
 *   2. Years. Same shape, stated as a number rather than a level.
 *   3. Missing required skills. Actionable — and the only negative that is
 *      also a to-do list.
 *   4. Work setup. On-site when they asked for remote is a hard no for many.
 *   5. Region.
 *   6. Function. Last, because a strong skill overlap across functions is
 *      often a genuine adjacent move rather than a mistake.
 *
 * ## Why the wording lives here rather than in SQL
 *
 * The migration returns facts; this returns sentences. Copy belongs where it
 * can be read in review, tested, and eventually translated — not inside a
 * function body that nobody reads after it is applied.
 */

export type MatchWhy = {
  matched_required?: string[] | null;
  matched_nice?: string[] | null;
  missing_required?: string[] | null;
  seniority?: {
    job?: string | null;
    want_lo?: string | null;
    want_hi?: string | null;
    /** Signed, in levels. Positive means the job is above what was asked for. */
    delta?: number | null;
  } | null;
  years?: { req_min?: number | null; req_max?: number | null; mine?: number | null } | null;
  region?: { job?: string | null; ok?: boolean | null } | null;
  remote?: { job?: string | null; ok?: boolean | null } | null;
  function?: { job?: string | null; ok?: boolean | null } | null;
};

export interface MatchExplanation {
  /** Short phrases, in the order they should be shown. */
  positives: string[];
  /** The single biggest gap, or null when there is nothing worth saying. */
  negative: string | null;
  /** Required skills the reader does not have. For the "add these" list. */
  missing: string[];
}

const SENIORITY_LABEL: Record<string, string> = {
  student: "Student",
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Team lead",
  manager: "Manager",
  director: "Director",
  exec: "Executive",
};

const REMOTE_LABEL: Record<string, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

const label = (map: Record<string, string>, key: string | null | undefined) =>
  key ? (map[key] ?? key) : null;

/** "kafka, go and terraform" — an English list, up to three. */
function listOf(items: string[], max = 3): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  let text: string;
  if (shown.length <= 1) text = shown[0] ?? "";
  else if (shown.length === 2) text = `${shown[0]} and ${shown[1]}`;
  else text = `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${text} and ${rest} more` : text;
}

export function explainMatch(why: MatchWhy | null | undefined): MatchExplanation {
  const positives: string[] = [];
  const missing = (why?.missing_required ?? []).filter(Boolean);

  if (!why) return { positives, negative: null, missing };

  /* ---- positives ------------------------------------------------------- */

  const matched = (why.matched_required ?? []).filter(Boolean);
  if (matched.length) {
    positives.push(
      matched.length === 1
        ? `You have ${matched[0]}`
        : `You have ${listOf(matched, 4)}`,
    );
  }

  const nice = (why.matched_nice ?? []).filter(Boolean);
  if (nice.length) positives.push(`Nice-to-have: ${listOf(nice, 3)}`);

  if (why.seniority?.delta === 0 && why.seniority.job) {
    positives.push(`${label(SENIORITY_LABEL, why.seniority.job)} — the level you asked for`);
  }
  if (why.remote?.ok && why.remote.job && why.remote.job !== "unknown") {
    positives.push(`${label(REMOTE_LABEL, why.remote.job)}, as you wanted`);
  }
  if (why.region?.ok && why.region.job) {
    // Only worth saying when the reader actually expressed a preference; the
    // RPC reports ok:true for "no preference" too, and "in your region" on a
    // profile with no region set would be meaningless.
    if (why.region.job !== "unknown") positives.push("In a region you chose");
  }

  /* ---- the one negative ------------------------------------------------ */

  const negative = firstNegative(why, missing);

  return { positives, negative, missing };
}

function firstNegative(why: MatchWhy, missing: string[]): string | null {
  // 1. Seniority, up or down.
  const delta = why.seniority?.delta;
  if (typeof delta === "number" && delta !== 0) {
    const job = label(SENIORITY_LABEL, why.seniority?.job);
    const lo = label(SENIORITY_LABEL, why.seniority?.want_lo);
    const hi = label(SENIORITY_LABEL, why.seniority?.want_hi);
    if (job && delta > 0 && hi) return `Asks for ${job}; you chose up to ${hi}`;
    if (job && delta < 0 && lo) return `${job} role; you chose from ${lo} up`;
  }

  // 2. Years, when the posting states a figure and the reader falls short.
  const reqMin = why.years?.req_min;
  const mine = why.years?.mine;
  if (typeof reqMin === "number" && typeof mine === "number" && mine < reqMin - 1) {
    return `Wants ${reqMin}+ years; you list ${mine}`;
  }

  // 3. Missing required skills — the only negative that is also a to-do list.
  if (missing.length) return `Missing: ${listOf(missing, 3)}`;

  // 4. Work setup.
  if (why.remote?.ok === false && why.remote.job) {
    const shown = label(REMOTE_LABEL, why.remote.job);
    if (shown) return `${shown}; you asked for something else`;
  }

  // 5. Region.
  if (why.region?.ok === false && why.region.job) {
    return "Outside the regions you chose";
  }

  // 6. Function, last.
  if (why.function?.ok === false) return "A different field from the one you chose";

  return null;
}
