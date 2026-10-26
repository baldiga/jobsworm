/**
 * CV parsing, heuristic and local.
 *
 * PLAN.md section 13 is explicit that this stays a heuristic parser plus user
 * correction rather than an LLM call: there is no paid model in the MVP, and a
 * parser the user can fix beats a black box that is confidently wrong.
 *
 * Skills come from `extractSkills`, the exact matcher used to decompose job
 * postings. Reusing it rather than writing a second one is the whole point:
 * matching only works if both sides of the comparison agree on what "React" or
 * "בדיקות תוכנה" is called.
 *
 * WHAT WENT WRONG BEFORE: that matcher only knew the tech dictionary, and
 * TITLE_HINTS listed nothing but engineering roles. A marketing and RevOps CV
 * therefore matched on whatever incidental tech words it contained and came
 * back looking like a programmer, because those were the only terms the parser
 * could see. Two changes fixed it: the matcher now also carries the
 * go-to-market vocabulary, and the CV gets a FUNCTION of its own, classified by
 * the same code that classifies a job posting.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PASS ADDS, AND WHY
 *
 * The version above still read a CV as one undifferentiated blob of words, and
 * that costs accuracy in three specific ways.
 *
 * 1. A CV IS NOT FLAT. The job someone had eight years ago is in the same bag
 *    of words as the job they have now, so a marketer who started as a QA
 *    tester still carries a decade of QA vocabulary. The document is now split
 *    into sections, and the EXPERIENCE section is weighted — with its opening,
 *    where the current role sits, weighted again. What someone does now is what
 *    they are looking for; what they did in 2017 is background.
 *
 * 2. YEARS OF EXPERIENCE WAS A GUESS. It took the largest "N years" anywhere in
 *    the file, which happily reads "10 years" out of "10 years ago" or out of a
 *    line about a product being ten years old. Employment DATE RANGES are the
 *    better evidence and most CVs are full of them, so the spans are now parsed
 *    and merged, and overlapping jobs are counted once. A stated figure is
 *    still read, and the two are reconciled rather than one blindly winning.
 *
 * 3. TITLES CAME FROM A FIXED LIST. Whatever was not on the list did not exist,
 *    so "Growth Marketing Lead" and "מנהלת הצלחת לקוחות בכירה" returned
 *    nothing. Role lines are now recognised structurally — a short line above a
 *    date range, or one shaped "Title at Company" or "Title | Company" — which
 *    finds real titles the list never anticipated. The curated list stays,
 *    because it is what makes the common cases exact.
 *
 * None of this is clever, and none of it needs a model. It is just reading the
 * document as a document instead of as a word count.
 */

import { normalizeHe } from "./normalize";
import { extractSkills, classifyFunction } from "./decompose";
import { repairVisualText } from "./rtl";

export type CvSection = "experience" | "education" | "skills" | "summary" | "other";

export type ParsedCv = {
  skills: string[];
  titles: string[];
  yearsExperience: number | null;
  headline: string | null;
  /** Same enum as `jobs.function`, so matching can compare like with like. */
  jobFunction: string | null;
  /** 0-1. Low means the CV is mixed, and the UI should invite a correction. */
  functionConfidence: number;
  textLength: number;
  /** How the years figure was reached, so the UI can say so rather than assert. */
  yearsBasis: "dates" | "stated" | null;
  /** The current or most recent role, when one could be identified. */
  currentTitle: string | null;
  /** Which sections were actually found. Empty means the CV parsed as one blob. */
  sectionsFound: CvSection[];
};

/* -------------------------------------------------------------------------
 * Sections
 * ---------------------------------------------------------------------- */

/**
 * Section headings, in both languages.
 *
 * Matched against a whole line, because "experience" appears inside ordinary
 * sentences constantly ("experience with Kubernetes") and would otherwise split
 * the document at random. A heading is a short line that is nothing but the
 * heading, which is exactly how people write them.
 */
const SECTION_HEADINGS: [CvSection, string[]][] = [
  [
    "experience",
    [
      "experience",
      "work experience",
      "professional experience",
      "employment",
      "employment history",
      "work history",
      "career",
      "career history",
      "ניסיון",
      "ניסיון תעסוקתי",
      "ניסיון מקצועי",
      "נסיון תעסוקתי",
      "תעסוקה",
      "היסטוריה תעסוקתית",
    ],
  ],
  [
    "education",
    ["education", "academic background", "qualifications", "השכלה", "השכלה אקדמית", "לימודים"],
  ],
  [
    "skills",
    [
      "skills",
      "technical skills",
      "core skills",
      "technologies",
      "tools",
      "כישורים",
      "מיומנויות",
      "כלים",
      "טכנולוגיות",
    ],
  ],
  [
    "summary",
    ["summary", "profile", "about", "about me", "objective", "תקציר", "אודות", "פרופיל"],
  ],
];

/** Longest-first, so "work experience" is not shadowed by "experience". */
const HEADING_INDEX: [string, CvSection][] = SECTION_HEADINGS.flatMap(([section, words]) =>
  words.map((w) => [w, section] as [string, CvSection]),
).sort((a, b) => b[0].length - a[0].length);

/** A heading line, or null. Trailing colons and bullets are stripped first. */
function headingOf(line: string): CvSection | null {
  const clean = normalizeHe(line)
    .toLowerCase()
    .replace(/^[\s•*\-–—|]+/, "")
    .replace(/[:：\s]+$/, "")
    .trim();
  // A real heading is short. "Experience with distributed systems" is not one.
  if (!clean || clean.length > 32) return null;
  for (const [word, section] of HEADING_INDEX) {
    if (clean === word) return section;
  }
  return null;
}

export type CvSections = Record<CvSection, string>;

/** Split a CV into labelled sections. Everything before the first heading is `other`. */
export function splitCvSections(text: string): { sections: CvSections; found: CvSection[] } {
  const sections: CvSections = {
    experience: "",
    education: "",
    skills: "",
    summary: "",
    other: "",
  };
  const found = new Set<CvSection>();

  let current: CvSection = "other";
  for (const line of text.split(/\r?\n/)) {
    const heading = headingOf(line);
    if (heading) {
      current = heading;
      found.add(heading);
      continue;
    }
    sections[current] += line + "\n";
  }
  return { sections, found: [...found] };
}

/* -------------------------------------------------------------------------
 * Dates and years of experience
 * ---------------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/** "present", in the forms people actually type. */
const PRESENT = /^(present|current|now|today|היום|כיום|הווה)$/i;

type Span = { from: number; to: number };

const YEAR = "(?:19|20)\\d{2}";
const MONTH_WORD = "[A-Za-z]{3,9}";
const DASH = "\\s*(?:-|–|—|to|until|עד)\\s*";

/**
 * Employment date ranges.
 *
 * Three shapes cover almost every CV: "Jan 2019 - Mar 2022", "01/2019 - 2022",
 * and a bare "2019 - 2022". The bare form is last because it is the one that
 * also matches page numbers and version strings, so it only applies when
 * nothing richer was found on the same line.
 */
const RANGE_PATTERNS = [
  new RegExp(`(${MONTH_WORD})\\.?\\s+(${YEAR})${DASH}(?:(${MONTH_WORD})\\.?\\s+(${YEAR})|(present|current|now|today|היום|כיום|הווה))`, "gi"),
  new RegExp(`(\\d{1,2})[./](${YEAR})${DASH}(?:(\\d{1,2})[./](${YEAR})|(present|current|now|today|היום|כיום|הווה))`, "gi"),
  new RegExp(`(?<![\\d/.])(${YEAR})${DASH}(?:(${YEAR})|(present|current|now|today|היום|כיום|הווה))(?![\\d/.])`, "gi"),
];

function monthIndex(word: string | undefined): number {
  if (!word) return 0;
  const m = MONTHS[word.toLowerCase()];
  return m === undefined ? 0 : m;
}

/** Extract employment spans as month counts since year 0, ignoring nonsense. */
export function extractSpans(text: string, now = new Date()): Span[] {
  const nowMonths = now.getFullYear() * 12 + now.getMonth();
  const spans: Span[] = [];

  const push = (fromY: number, fromM: number, toY: number | null, toM: number) => {
    const from = fromY * 12 + fromM;
    const to = toY === null ? nowMonths : toY * 12 + toM;
    // A range that ends before it starts, or runs into the future, is a
    // misparse rather than a career.
    if (to < from || from > nowMonths || to - from > 50 * 12) return;
    spans.push({ from, to: Math.min(to, nowMonths) });
  };

  for (const line of text.split(/\r?\n/)) {
    let matchedRicherForm = false;
    for (let i = 0; i < RANGE_PATTERNS.length; i++) {
      // The bare "2019 - 2022" form only applies if nothing better matched on
      // this line, because it is the form most likely to be a false positive.
      if (i === 2 && matchedRicherForm) continue;
      const re = new RegExp(RANGE_PATTERNS[i].source, RANGE_PATTERNS[i].flags);
      for (const m of line.matchAll(re)) {
        if (i === 0) {
          if (!(m[1].toLowerCase() in MONTHS)) continue;
          matchedRicherForm = true;
          const open = m[5] && PRESENT.test(m[5]);
          push(Number(m[2]), monthIndex(m[1]), open ? null : Number(m[4]), monthIndex(m[3]));
        } else if (i === 1) {
          matchedRicherForm = true;
          const open = m[5] && PRESENT.test(m[5]);
          push(Number(m[2]), Number(m[1]) - 1, open ? null : Number(m[4]), Number(m[3]) - 1);
        } else {
          const open = m[3] && PRESENT.test(m[3]);
          push(Number(m[1]), 0, open ? null : Number(m[2]), 0);
        }
      }
    }
  }
  return spans;
}

/**
 * Total months worked, with overlaps counted once.
 *
 * Two jobs held at the same time are one stretch of experience, not two. Adding
 * spans naively is how a CV with a side project turns into twenty years.
 */
export function mergedMonths(spans: Span[]): number {
  if (!spans.length) return 0;
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  let total = 0;
  let { from, to } = sorted[0];
  for (const s of sorted.slice(1)) {
    if (s.from <= to) {
      to = Math.max(to, s.to);
    } else {
      total += to - from;
      ({ from, to } = s);
    }
  }
  return total + (to - from);
}

/**
 * Headings whose block is definitely not employment.
 *
 * Only consulted when the experience section was not recognised, and only to
 * REMOVE text. Military service is on the list for two reasons: PLAN.md's
 * never-collect rule, and the fact that a three-year conscription dated
 * 2010-2013 is what turns a five-year career into a twelve-year one.
 */
const NON_EMPLOYMENT_HEADINGS = [
  "education", "academic background", "qualifications", "studies", "courses",
  "course", "certifications", "certificates", "training", "military service",
  "military", "army", "idf", "service", "volunteering", "volunteer",
  "volunteer experience", "awards", "publications", "languages", "references",
  "השכלה", "השכלה אקדמית", "לימודים", "קורסים", "הכשרות", "תעודות", "הסמכות",
  "שירות צבאי", "שירות", "צבא", "צה\"ל", "התנדבות", "פרסומים", "שפות", "פרסים",
];

/**
 * The text a career length may be measured from.
 *
 * This is the fix for a reported bug: someone with about five years was shown
 * twelve, and could not correct it. The cause was the fallback — the span
 * reader was handed `sections.experience || text`, so a CV whose experience
 * heading was not recognised had its ENTIRE contents read as employment. A
 * degree, military service and a couple of courses each carry a date range,
 * and merged with the real jobs they produce a career starting the year the
 * person left school.
 *
 * When the experience section is known, use exactly that — the common case
 * and always the right answer. When it is not, drop every block under a
 * heading that cannot be employment and measure what is left.
 *
 * Removing rather than selecting is deliberate. The reason we are here at all
 * is that the experience heading was unrecognised, so trying to guess which
 * remaining block IS the jobs would be the same guess failing twice. Dropping
 * what is certainly not employment is the weaker claim and the safer one.
 */
export function employmentText(sections: CvSections, whole: string): string {
  if (sections.experience.trim()) return sections.experience;

  const kept: string[] = [];
  let dropping = false;
  for (const line of whole.split(/\r?\n/)) {
    const clean = normalizeHe(line)
      .toLowerCase()
      .replace(/^[\s•*\-–—|]+/, "")
      .replace(/[:：\s]+$/, "")
      .trim();

    if (clean && clean.length <= 32) {
      if (NON_EMPLOYMENT_HEADINGS.includes(clean)) {
        dropping = true;
        continue;
      }
      // Any other recognised heading ends the block being dropped.
      if (headingOf(line)) dropping = false;
      // An unrecognised short line after a dropped block is very likely the
      // next heading ("Where I have worked"), so stop dropping there too.
      else if (dropping && /^[\p{L} .,&/'-]{3,32}$/u.test(clean)) dropping = false;
    }

    if (!dropping) kept.push(line);
  }

  const out = kept.join("\n");
  // If the strip took nearly everything, the headings were misread and an
  // over-count beats a silent null.
  return out.trim().length > whole.trim().length * 0.25 ? out : whole;
}

const STATED_YEARS = [
  /(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp\b)/gi,
  /(?:over|more than|about|around)\s+(\d{1,2})\s*(?:years?|yrs?)/gi,
  /(\d{1,2})\s*\+?\s*(?:שנות\s+ניסיון|שנים\s+ניסיון|שנות\s+נסיון|שנות\s+נסיון)/g,
];

/**
 * A stated figure, but only where the sentence says it is about experience.
 *
 * The old pattern was any "N years" at all, which read "10 years" out of "the
 * product has been running for 10 years" and out of "10 years ago". Requiring
 * the word experience nearby costs a few true matches and removes most of the
 * false ones, which is the right trade for a number shown to the user.
 */
export function statedYears(text: string): number | null {
  let best: number | null = null;
  for (const re of STATED_YEARS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0 && n < 50) best = Math.max(best ?? 0, n);
    }
  }
  return best;
}

/* -------------------------------------------------------------------------
 * Titles
 * ---------------------------------------------------------------------- */

/**
 * Role titles worth recognising, across every function the index carries — not
 * just engineering. Ordered longest-first at match time so "product marketing
 * manager" beats both "product manager" and "marketing".
 */
const TITLE_HINTS = [
  // Engineering
  "software engineer", "backend developer", "frontend developer", "full stack developer",
  "data engineer", "data analyst", "data scientist", "devops engineer", "sre",
  "qa engineer", "automation engineer", "security engineer", "cloud engineer",
  "mobile developer", "android developer", "ios developer", "machine learning engineer",
  "solutions engineer", "sales engineer", "architect", "team lead", "tech lead",
  // Product and design
  "product manager", "product owner", "product marketing manager",
  "ux designer", "ui designer", "product designer", "ux researcher", "graphic designer",
  // Go-to-market — the half that was missing
  "marketing manager", "growth manager", "demand generation manager",
  "performance marketing manager", "content marketing manager", "brand manager",
  "digital marketing manager", "social media manager", "community manager",
  "seo specialist", "ppc specialist", "campaign manager", "crm manager",
  "revops", "revenue operations", "sales operations", "marketing operations",
  "account executive", "account manager", "sales manager", "sales development representative",
  "business development manager", "partnerships manager",
  "customer success manager", "customer support manager", "solutions consultant",
  // Business
  "project manager", "program manager", "operations manager", "chief of staff",
  "finance manager", "controller", "financial analyst", "bookkeeper",
  "hr manager", "hr business partner", "technical recruiter", "recruiter", "talent acquisition",
  // Hebrew
  "מפתח", "מפתחת", "מהנדס תוכנה", "בודק תוכנה", "מנהל מוצר", "אנליסט", "ראש צוות",
  "מנהל שיווק", "מנהל מכירות", "מנהל קמפיינים", "מנהל תוכן", "מעצב",
  "מנהל פרויקטים", "מנהל תפעול", "מנהל כספים", "מגייס", "משאבי אנוש",
  "הצלחת לקוחות", "פיתוח עסקי",
].sort((a, b) => b.length - a.length);

/**
 * Words that make a line a role line rather than a company, a school or prose.
 *
 * Kept broad on purpose: this runs only on lines that already look structurally
 * like a role — short, near a date, or in "X at Y" form — so it is a filter on
 * a small candidate set rather than a search over the whole document.
 */
const ROLE_WORDS =
  /(engineer|developer|manager|lead|head|director|analyst|designer|specialist|consultant|architect|scientist|officer|executive|coordinator|associate|administrator|recruiter|marketer|owner|founder|intern|representative|operations|partner|strategist|advisor|technician|accountant|writer|producer|vp|cto|ceo|cmo|coo|cfo|מפתח|מהנדס|מנהל|מנהלת|ראש|אנליסט|מעצב|מעצבת|רכז|רכזת|יועץ|יועצת|סמנכ|בודק|בודקת|מגייס|מגייסת)/i;

const AT_SPLIT = /\s+(?:at|@|\||[-–—]|ב-|בחברת)\s+/i;
const HAS_DATE = new RegExp(`${YEAR}|\\b${MONTH_WORD}\\.?\\s+${YEAR}`, "i");

/**
 * Role titles read from the document's own structure.
 *
 * Two shapes, both common enough to be worth the code:
 *   "Growth Marketing Lead at Wix"    a role and an employer on one line
 *   "Growth Marketing Lead"           a short line sitting on or above a date
 *                                     range, which is how every CV template
 *                                     lays out an employment entry
 */
export function structuralTitles(experience: string): string[] {
  const lines = experience.split(/\r?\n/).map((l) => l.trim());
  const out: string[] = [];

  const consider = (candidate: string) => {
    const t = candidate
      .replace(/^[\s•*\-–—|]+/, "")
      .replace(/[,;:.]+$/, "")
      .trim();
    // Long enough to be a title, short enough not to be a sentence.
    if (t.length < 3 || t.length > 60) return;
    if (!ROLE_WORDS.test(t)) return;
    if (/\d{4}/.test(t)) return; // still carrying a date: not a clean title
    if (!out.some((seen) => seen.toLowerCase() === t.toLowerCase())) out.push(t);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (AT_SPLIT.test(line) && line.length <= 90) {
      consider(line.split(AT_SPLIT)[0]);
      continue;
    }

    // A bare short line immediately above or below a date range.
    if (line.length <= 60 && !HAS_DATE.test(line)) {
      const near = [lines[i + 1], lines[i - 1]].filter(Boolean) as string[];
      if (near.some((n) => HAS_DATE.test(n))) consider(line);
      continue;
    }

    // "Senior RevOps Manager, 2021 - present" — title and date on one line.
    if (HAS_DATE.test(line) && line.length <= 90) {
      consider(line.split(/[,|]|\s{2,}/)[0]);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------
 * The parser
 * ---------------------------------------------------------------------- */

/**
 * How much of the experience section counts as "the current role".
 *
 * Generous on purpose. A CV entry is a title, a company, some dates and three
 * to six bullets, which is comfortably under 1,200 characters, and overshooting
 * into the previous job is much less harmful than cutting the current one off
 * halfway through its responsibilities.
 */
const CURRENT_ROLE_CHARS = 1200;

export function parseCv(input: string, now = new Date()): ParsedCv {
  /*
   * Put the document the right way round first, if it is not already.
   *
   * Many PDF generators write Hebrew in VISUAL order — the order the glyphs
   * are painted across the page, which for a right-to-left script is the
   * reverse of the logical order. The file looks correct in a viewer and
   * extracts backwards, so every lookup below fails and the person is told we
   * recognised no skills, for a CV that is perfectly legible on their screen.
   *
   * `repairVisualText` returns the input untouched unless a clear majority of
   * its Hebrew lines are reversed, so this costs nothing for the English and
   * correctly-ordered Hebrew documents that are the common case.
   */
  const { text } = repairVisualText(input);
  const raw = text.replace(/\s+/g, " ").trim();
  const { sections, found } = splitCvSections(text);

  const skills = extractSkills(raw).slice(0, 60);

  /*
   * Years of experience, from dates first and the stated figure second.
   *
   * When both exist they are reconciled rather than one winning outright: a
   * stated figure that is close to the dates confirms them, and a stated figure
   * wildly above them usually means the person is counting something the CV
   * does not show, so the dates are trusted and the claim is not. A stated
   * figure ABOVE the dates by a little is normal and kept, because CVs
   * routinely omit the earliest jobs.
   */
  const months = mergedMonths(extractSpans(employmentText(sections, text), now));
  const fromDates = months >= 6 ? Math.round((months / 12) * 10) / 10 : null;
  const stated = statedYears(text);

  let years: number | null = null;
  let yearsBasis: "dates" | "stated" | null = null;
  if (fromDates != null && stated != null) {
    if (stated > fromDates * 1.6) {
      // Claiming much more than the CV shows: trust the dates.
      years = fromDates;
      yearsBasis = "dates";
    } else if (stated * 1.6 < fromDates) {
      /*
       * Claiming much LESS than the dates. This used to be ignored — the old
       * rule took `max(fromDates, stated)` — and it is how somebody with five
       * years was told they had twelve.
       *
       * The asymmetry made no sense. A wildly high claim was treated as the
       * person over-counting; a wildly low one should be treated as the dates
       * over-counting, which is exactly what happens when a degree or military
       * service is read as employment. Between a figure the person wrote about
       * themselves and a span we inferred, the person wins when the two are
       * far apart.
       */
      years = stated;
      yearsBasis = "stated";
    } else {
      // They agree closely enough. CVs routinely omit the earliest jobs, so a
      // slightly higher stated figure is normal and kept.
      years = Math.max(fromDates, stated);
      yearsBasis = "dates";
    }
  } else if (fromDates != null) {
    years = fromDates;
    yearsBasis = "dates";
  } else if (stated != null) {
    years = stated;
    yearsBasis = "stated";
  }
  if (years != null) years = Math.round(years);

  // Curated titles, then the ones read from the document's own structure.
  const hay = normalizeHe(raw).toLowerCase();
  const known = TITLE_HINTS.filter((t) => hay.includes(t.toLowerCase()));
  const structural = structuralTitles(sections.experience || text);
  const titles = [...new Set([...known, ...structural])].slice(0, 10);

  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 3) ?? "";
  const headline = firstLine ? firstLine.slice(0, 120) : null;
  const currentTitle = structural[0] ?? known[0] ?? null;

  /*
   * Classify the CV with the same function classifier used on job postings, but
   * do not hand it the whole document.
   *
   * The title side gets the current role first, because that is the single
   * strongest signal about what someone is looking for next, and the classifier
   * weights title cues three times a body cue.
   *
   * The body side is the experience section, with its opening repeated so the
   * current role counts roughly twice. Education is left out entirely: a
   * computer science degree is not evidence that someone wants a programming
   * job fifteen years later, and it was part of why career-changers came back
   * labelled as engineers.
   */
  const titleSide = normalizeHe(
    [currentTitle ?? "", headline ?? "", ...titles.slice(0, 4)].join(" "),
  );
  const experience = sections.experience.trim();
  const bodySide = experience
    ? normalizeHe(
        [experience.slice(0, CURRENT_ROLE_CHARS), experience, sections.skills, sections.summary]
          .join(" ")
          .slice(0, 20_000),
      )
    : raw;

  const fn = classifyFunction(titleSide, bodySide);

  return {
    skills,
    titles,
    yearsExperience: years,
    headline,
    jobFunction: fn.fn === "non_tech" ? null : fn.fn,
    functionConfidence: Number.isFinite(fn.conf) ? fn.conf : 0,
    textLength: raw.length,
    yearsBasis,
    currentTitle,
    sectionsFound: found,
  };
}

/** Rough seniority from stated years, using the decomposition thresholds. */
export function seniorityFromYears(years: number | null): string | null {
  if (years == null) return null;
  if (years <= 1) return "junior";
  if (years <= 4) return "mid";
  if (years <= 7) return "senior";
  return "lead";
}
