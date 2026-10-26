/**
 * What a job pays, and what else comes with it.
 *
 * ## Salary is required on anything a recruiter posts here
 *
 * Not encouraged — required. It is the single most common complaint about
 * every Israeli job board, and it is the one thing this index can insist on
 * for the listings it controls. Scraped listings keep whatever the source
 * gave; a listing somebody posts *through* Jobsworm states a number or it
 * does not go up.
 *
 * The figure is **monthly gross base salary in shekels**, which is how pay is
 * discussed in Israel. Not annual, not total compensation, not "competitive".
 * Equity and the rest live in `totalComp` and `benefits` below, separately, so
 * a base of ₪25,000 cannot be dressed up as ₪40,000 by folding in options
 * nobody can value.
 *
 * ## The bounds
 *
 * ₪6,000 is a little under a full-time minimum wage, so anything below it is
 * either a mistake, a part-time role priced as full-time, or not a salary at
 * all.
 *
 * ₪150,000 is the ceiling, and it was lowered from ₪1,000,000 for a reason
 * worth writing down. The point of a ceiling is to catch an annual figure
 * typed into a monthly field — and ₪1,000,000 did not, because the annual
 * packages people actually type (₪300,000–₪600,000) sit comfortably inside it
 * and would publish as a monthly salary five to twenty times too large. A
 * ceiling that admits the exact mistake it exists to catch is decoration.
 *
 * ₪150,000 a month is ₪1.8M a year in base alone. Above that is not a salary
 * somebody is typing into a job advert; it is an annual figure, or an extra
 * zero. The band from ₪100,000 up is still legal and still warned about, which
 * leaves room for the genuine executive package while refusing the common
 * error outright.
 *
 * Neither bound is a judgement about what a job should pay. They are the range
 * within which a number is plausibly a monthly Israeli salary.
 */

/** Monthly gross base, in shekels. Below this it is not a full-time salary. */
export const SALARY_MIN_ILS = 6_000;

/** A sanity ceiling, not a market one. Catches annual figures and typos. */
export const SALARY_MAX_ILS = 150_000;

export type SalaryRange = {
  min: number;
  max: number;
  currency: "ILS";
  period: "month";
  /** Who stated it. "employer" means it came from the posting form. */
  source: "employer";
};

export type TotalComp = {
  min: number;
  max: number;
  currency: "ILS";
  /** TC is the one figure people quote annually, so it carries its period. */
  period: "year" | "month";
  note?: string | null;
};

export type SalaryProblem =
  | "missing"
  | "not_a_number"
  | "below_minimum"
  | "above_maximum"
  | "inverted";

export interface SalaryCheck {
  ok: boolean;
  problem: SalaryProblem | null;
  /** Ready to store in `jobs.salary`. Null when the check failed. */
  value: SalaryRange | null;
}

/**
 * English for each problem, written to be shown to the person who typed it.
 *
 * Each one says what to do, not just what is wrong. "Invalid salary" tells a
 * recruiter nothing; "monthly base salary in shekels, not annual" tells them
 * exactly which mistake they made, and it is the mistake most of them make.
 */
export const SALARY_PROBLEM_TEXT: Record<SalaryProblem, string> = {
  missing: "Add the salary range. Every listing posted through Jobsworm shows one.",
  not_a_number: "Enter the salary as numbers, without commas or currency symbols.",
  below_minimum: `That is below ₪${SALARY_MIN_ILS.toLocaleString("en-IL")} a month. This field is monthly gross base salary — if the figure is part-time or hourly, state the monthly equivalent.`,
  above_maximum: `That is above ₪${SALARY_MAX_ILS.toLocaleString("en-IL")} a month. This field is monthly base salary, not annual — check the figure.`,
  inverted: "The top of the range is lower than the bottom.",
};

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    // Tolerate "25,000" and "₪25000" — a recruiter typing the way people
    // write money is not an error worth rejecting them over.
    const cleaned = v.replace(/[₪,\s]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Validates a submitted range and returns the row value, or the problem. */
export function checkSalary(minRaw: unknown, maxRaw: unknown): SalaryCheck {
  const fail = (problem: SalaryProblem): SalaryCheck => ({ ok: false, problem, value: null });

  if (minRaw === null || minRaw === undefined || minRaw === "") return fail("missing");
  if (maxRaw === null || maxRaw === undefined || maxRaw === "") return fail("missing");

  const min = toNumber(minRaw);
  const max = toNumber(maxRaw);
  if (min === null || max === null) return fail("not_a_number");

  // Check the inversion before the bounds: told "below the minimum" when the
  // real mistake is that the two boxes are the wrong way round, a person
  // edits the wrong field.
  if (max < min) return fail("inverted");
  if (min < SALARY_MIN_ILS) return fail("below_minimum");
  if (max > SALARY_MAX_ILS) return fail("above_maximum");

  return {
    ok: true,
    problem: null,
    value: {
      min: Math.round(min),
      max: Math.round(max),
      currency: "ILS",
      period: "month",
      source: "employer",
    },
  };
}

/**
 * Above this, a "monthly" figure deserves a second look.
 *
 * ₪100,000 a month is ₪1.2M a year in base salary alone — a number that exists
 * in Israel but is rare. The hard ceiling above is ₪150,000, so this leaves a
 * narrow band that is legal, plausible for an executive, and worth asking
 * about.
 *
 * A warning rather than a rejection, because within this band both readings
 * are genuinely possible. Above the ceiling they are not, and that is refused
 * outright.
 */
export const SALARY_LIKELY_ANNUAL_ILS = 100_000;

/** True when the figure is legal but looks like an annual salary. */
export function salaryLooksAnnual(salary: SalaryRange | null): boolean {
  return Boolean(salary && salary.min >= SALARY_LIKELY_ANNUAL_ILS);
}

/*
 * Total compensation gets its OWN bounds, not the base-salary ones.
 *
 * Tying them together was a mistake the tighter base ceiling exposed: with
 * `SALARY_MAX_ILS` at ₪150,000, a derived annual cap of twelve times that is
 * ₪1.8M — which silently discards a perfectly real executive package, and
 * discards it quietly, because a malformed TC is simply dropped rather than
 * reported. TC includes equity, so it is legitimately a different order of
 * magnitude from base and needs a number of its own.
 */
export const TOTAL_COMP_MAX_YEAR_ILS = 10_000_000;
export const TOTAL_COMP_MAX_MONTH_ILS = 1_000_000;

/**
 * Optional total compensation, when the employer wants to state one.
 *
 * Returns null rather than an error for an empty input: TC is optional, and a
 * half-filled optional field is a person who changed their mind, not a
 * validation failure. A partially filled one (min without max) is simply
 * dropped.
 */
export function checkTotalComp(
  minRaw: unknown,
  maxRaw: unknown,
  period: "year" | "month" = "year",
  note?: string | null,
): TotalComp | null {
  const min = toNumber(minRaw);
  const max = toNumber(maxRaw);
  if (min === null || max === null) return null;
  if (min <= 0 || max < min) return null;
  if (max > (period === "year" ? TOTAL_COMP_MAX_YEAR_ILS : TOTAL_COMP_MAX_MONTH_ILS)) return null;
  return {
    min: Math.round(min),
    max: Math.round(max),
    currency: "ILS",
    period,
    note: note?.trim() ? note.trim().slice(0, 120) : null,
  };
}

/* ------------------------------------------------------------------------- */
/* Benefits                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * The checklist an employer ticks, and the labels a reader sees.
 *
 * A fixed list rather than free text, for two reasons. It is comparable —
 * "sick leave from day one" means the same thing on every listing that claims
 * it, which free text never does. And it is filterable later without a
 * natural-language problem: these keys go into `jobs.benefits text[]`, which
 * already exists and is already indexed.
 *
 * The list is deliberately Israel-shaped. Keren Hishtalmut and a Sibus card
 * are what people actually compare offers on here; "unlimited PTO" is not.
 *
 * `group` only orders the form. Changing a label is safe; changing a KEY is
 * not, because the keys are stored on every row that used them.
 */
export type BenefitGroup = "equity" | "money" | "time" | "daily" | "growth";

export interface BenefitDef {
  key: string;
  label: string;
  group: BenefitGroup;
  /** Shown under the checkbox where the term is easy to get wrong. */
  hint?: string;
}

export const BENEFITS: readonly BenefitDef[] = [
  // Equity — the part people most often cannot value, so it is named precisely.
  { key: "equity_options", label: "Stock options", group: "equity" },
  { key: "equity_rsu", label: "RSUs", group: "equity" },
  {
    key: "equity_espp",
    label: "Employee stock purchase plan",
    group: "equity",
    hint: "Buy company shares at a discount",
  },

  // Money beyond base.
  { key: "annual_bonus", label: "Annual bonus", group: "money" },
  {
    key: "keren_hishtalmut",
    label: "Keren Hishtalmut from day one",
    group: "money",
    hint: "Not after six months — from the first day",
  },
  { key: "pension_above_min", label: "Pension above the legal minimum", group: "money" },
  { key: "car_or_allowance", label: "Company car or travel allowance", group: "money" },
  { key: "relocation", label: "Relocation support", group: "money" },

  // Time.
  {
    key: "sick_leave_day_one",
    label: "Sick leave paid from day one",
    group: "time",
    hint: "The law pays nothing for the first day and half for days two and three",
  },
  { key: "extra_vacation", label: "More vacation days than the legal minimum", group: "time" },
  { key: "extended_parental", label: "Extended parental leave", group: "time" },
  { key: "flexible_hours", label: "Flexible hours", group: "time" },

  // Daily life.
  { key: "meal_card_sibus", label: "Sibus / Cibus meal card", group: "daily" },
  { key: "meal_credit_wolt", label: "Wolt or 10bis credit", group: "daily" },
  { key: "meals_on_site", label: "Meals provided on site", group: "daily" },
  { key: "parking", label: "Parking", group: "daily" },
  { key: "home_office_budget", label: "Home-office budget", group: "daily" },
  { key: "private_health", label: "Private health insurance", group: "daily" },
  { key: "gym_wellness", label: "Gym or wellness allowance", group: "daily" },

  // Growth.
  { key: "learning_budget", label: "Learning and conference budget", group: "growth" },
  { key: "hebrew_or_english_lessons", label: "Hebrew or English lessons", group: "growth" },
] as const;

export const BENEFIT_GROUP_LABEL: Record<BenefitGroup, string> = {
  equity: "Equity",
  money: "Money beyond base salary",
  time: "Time off",
  daily: "Day to day",
  growth: "Growth",
};

const BENEFIT_KEYS = new Set(BENEFITS.map((b) => b.key));
const BENEFIT_LABELS = new Map(BENEFITS.map((b) => [b.key, b.label]));

/**
 * Keeps only keys from the catalogue.
 *
 * The array is submitted by a browser and stored in a column the job page
 * renders, so an unknown key is either a stale client or somebody trying to
 * write their own text into a list of vetted claims. Either way it is dropped
 * rather than rejected: a recruiter should not lose a form because one
 * checkbox was renamed in a deploy.
 */
export function cleanBenefits(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const key = raw.trim();
    if (BENEFIT_KEYS.has(key)) seen.add(key);
  }
  // Catalogue order, not submission order, so two listings with the same
  // benefits render identically.
  return BENEFITS.filter((b) => seen.has(b.key)).map((b) => b.key);
}

/** The reader-facing label, or the raw key for anything scraped and unknown. */
export function benefitLabel(key: string): string {
  return BENEFIT_LABELS.get(key) ?? key;
}
