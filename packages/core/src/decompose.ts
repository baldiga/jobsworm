/**
 * Rule-based job decomposition — PLAN.md sections 5.1 and 5.2.
 *
 * Pure functions, no I/O, no LLM. Everything the rules cannot decide is left
 * `null` with a low `_conf` so the Claude labelling batch (PLAN 5.6) can pick
 * it up. Nothing here ever guesses a salary.
 */

import {
  collapseGenderForms,
  detectLang,
  normalizeHe,
  stripHtml,
} from "./normalize";
import { containsTerm, escapeRe, findTerm, hasHebrew } from "./text";
import { hebrewVariants } from "./synonyms";
import {
  CITIES,
  ISRAEL_ALIASES,
  ABROAD_TERMS,
  type CityEntry,
} from "./data/locations";
import { SKILLS, AMBIGUOUS, SKILL_INDEX } from "./data/skills";
import { BUSINESS_SKILLS, BUSINESS_AMBIGUOUS } from "./data/business-skills";
import {
  FUNCTION_DEFS,
  SUB_FUNCTIONS,
  isTech as gateIsTech,
  type JobFunction,
} from "./data/functions";
import {
  AGENCY_NAMES,
  AGENCY_STRONG_CUES,
  AGENCY_WEAK_CUES,
} from "./data/agencies";
import type {
  ApplyMethod,
  DecomposeInput,
  DecomposedJob,
  DecompMeta,
  Education,
  EmploymentType,
  FieldSource,
  JobLocation,
  Languages,
  QualityFlag,
  RemoteMode,
  Salary,
  Seniority,
} from "./types";

/**
 * Bumped whenever a rule changes what a stored row SHOULD say.
 *
 * `scripts/redecompose.ts` selects on it, so a fix that is not accompanied by
 * a bump reaches new postings only and leaves the existing index saying the
 * old thing forever. That is the shape of the problem this project keeps
 * finding: a rule corrected in code and never applied to the 4,000 rows
 * already decided by the old one.
 *
 * 2026-09-11: years scored rather than minimised, Hebrew skill boundaries,
 * Hebrew gender/number cue forms, US-IL read as Illinois, office cue implies
 * on-site.
 */
export const DECOMP_VERSION = "2026-09-11";

/* ------------------------------------------------------------------------- */
/* cue matching                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Most haystacks below are `normalizeHe()`d, which folds the Hebrew final
 * letters (ך ם ן ף ץ -> כ מ נ פ צ). The dictionary cues are written the way a
 * human spells them, so `ראשון` in a cue would never match `ראשונ` in the
 * haystack. `foldCue` applies the same fold to the needle.
 */
const FINAL_FOLD: Record<string, string> = {
  "ך": "כ",
  "ם": "מ",
  "ן": "נ",
  "ף": "פ",
  "ץ": "צ",
};

export function foldFinals(s: string): string {
  return s.replace(/[ךםןףץ]/g, (c) => FINAL_FOLD[c]!);
}

const foldCache = new Map<string, string>();

/** Lowercased + final-letter-folded cue, memoized (the lists are hot loops). */
export function foldCue(cue: string): string {
  let v = foldCache.get(cue);
  if (v === undefined) {
    v = foldFinals(cue.toLowerCase());
    foldCache.set(cue, v);
  }
  return v;
}

/**
 * Cached Hebrew gender/number forms of a cue.
 *
 * Only for single-word Hebrew cues. A multi-word cue is a phrase and
 * inflecting one word of it produces combinations nobody writes; a Latin cue
 * does not inflect this way at all. Memoized because `hasCue` runs over
 * thousands of cues per posting.
 */
const cueVariantCache = new Map<string, readonly string[]>();

function cueVariants(cue: string): readonly string[] {
  let v = cueVariantCache.get(cue);
  if (v === undefined) {
    v = /^[א-ת]{3,}$/.test(cue.trim()) ? hebrewVariants(cue) : [];
    cueVariantCache.set(cue, v);
  }
  return v;
}

/**
 * Boundary-aware `containsTerm` that works whether or not the haystack has
 * been normalized: it tries the cue as written, then its folded form, then its
 * Hebrew gender and number forms.
 *
 * ## Why the inflected forms matter here
 *
 * The dictionaries are written in the masculine singular, because that is how
 * a person writes a word down. Employers do not: `מעצבת UX` is an ordinary
 * Hebrew job title and `מעצב` never appears in it, so the design function was
 * simply not recognised on any posting written for a woman. Same for
 * `מפתחות`, `מהנדסת`, `אנליסטית`.
 *
 * Generating forms FROM the cue is safe in a way that stripping suffixes from
 * the text would not be: the worst case is a generated word that matches
 * nothing.
 */
export function hasCue(haystack: string, cue: string): boolean {
  if (containsTerm(haystack, cue)) return true;
  const folded = foldCue(cue);
  if (folded !== cue && containsTerm(haystack, folded)) return true;
  for (const v of cueVariants(folded)) {
    if (containsTerm(haystack, v)) return true;
  }
  return false;
}

/** Fold the Hebrew literals inside a RegExp source, keeping the metacharacters. */
function heRe(source: string, flags = "i"): RegExp {
  return new RegExp(foldFinals(source), flags);
}

/* ------------------------------------------------------------------------- */
/* section splitting                                                          */
/* ------------------------------------------------------------------------- */

export type SectionKind = "required" | "nice" | "body";

export interface Section {
  kind: SectionKind;
  heading: string | null;
  lines: string[];
}

const REQUIRED_HEADINGS: readonly string[] = [
  "דרישות",
  "דרישות התפקיד",
  "דרישות המשרה",
  "דרישות חובה",
  "מה נדרש",
  "מה אנחנו מחפשים",
  "הכישורים שלך",
  "requirements",
  "required",
  "must have",
  "must haves",
  "musts",
  "what you'll need",
  "what you will need",
  "what you need",
  "what you bring",
  "qualifications",
  "minimum qualifications",
  "basic qualifications",
  "who you are",
  "what we're looking for",
  "what we are looking for",
  "you have",
  "your experience",
  "skills and experience",
  "your profile",
];

const NICE_HEADINGS: readonly string[] = [
  "יתרון",
  "יתרונות",
  "יתרון משמעותי",
  "יתרון גדול",
  "נשמח אם",
  "בונוס",
  "nice to have",
  "nice-to-have",
  "nice to haves",
  "advantage",
  "advantages",
  "an advantage",
  "preferred",
  "preferred qualifications",
  "preferred skills",
  "bonus",
  "bonus points",
  "bonus points for",
  "plus",
  "pluses",
  "it's a plus",
  "desirable",
  "good to have",
  "extra credit",
];

/** Inline cues that flip a single bullet to "nice", wherever it sits. */
const NICE_INLINE: readonly string[] = [
  "יתרון",
  "יתרון משמעותי",
  "advantage",
  "an advantage",
  "a plus",
  "is a plus",
  "nice to have",
  "preferred",
  "bonus",
  "desirable",
];

/** Headings that end a requirements block without starting a new one. */
const BODY_HEADINGS: readonly string[] = [
  "תיאור התפקיד",
  "תיאור המשרה",
  "על החברה",
  "אודות",
  "אודותינו",
  "מה תעשו",
  "התפקיד כולל",
  "מה אנחנו מציעים",
  "הטבות",
  "about",
  "about us",
  "about the role",
  "about the team",
  "about the position",
  "the role",
  "responsibilities",
  "key responsibilities",
  "what you'll do",
  "what you will do",
  "your impact",
  "the opportunity",
  "benefits",
  "perks",
  "perks and benefits",
  "why join us",
  "our stack",
  "equal opportunity",
  "eeo statement",
];

const HEADING_TRIM = /^[\s\u2022*\-\u2013\u2014#>[\]()0-9.:]+|[\s:\uFF1A*#[\]()]+$/g;

function headingKind(line: string): SectionKind | null {
  if (line.length > 90) return null;
  const bare = line.replace(HEADING_TRIM, "").toLowerCase().trim();
  if (!bare || bare.length > 80) return null;
  // A heading is a short line that IS the phrase, not a sentence containing it.
  const match = (list: readonly string[]) =>
    list.some((h) => bare === h || bare.startsWith(`${h} `) || bare.startsWith(`${h}:`));
  if (match(NICE_HEADINGS)) return "nice";
  if (match(REQUIRED_HEADINGS)) return "required";
  if (match(BODY_HEADINGS)) return "body";
  return null;
}

/**
 * Split a plain-text description into required / nice / body sections.
 *
 * Two rules stack:
 *  1. a heading line switches the current section;
 *  2. a bullet containing an inline "advantage" cue is `nice` regardless of the
 *     section it sits in — this is how most Hebrew postings actually mark
 *     optional requirements.
 */
export function splitSections(text: string): Section[] {
  const out: Section[] = [];
  let current: Section = { kind: "body", heading: null, lines: [] };
  const push = () => {
    if (current.lines.length || current.heading) out.push(current);
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const kind = headingKind(line);
    if (kind) {
      push();
      current = { kind, heading: line, lines: [] };
      continue;
    }
    if (
      current.kind !== "nice" &&
      NICE_INLINE.some((c) => hasCue(line.toLowerCase(), c))
    ) {
      out.push({ kind: "nice", heading: null, lines: [line] });
      continue;
    }
    current.lines.push(line);
  }
  push();
  return out;
}

/* ------------------------------------------------------------------------- */
/* skills                                                                     */
/* ------------------------------------------------------------------------- */

interface AliasRow {
  alias: string;
  term: string;
  ambiguous: boolean;
}

/** Punctuation variants that show up in the wild for a multi-word alias. */
/**
 * Plural of a multi-word alias, or null.
 *
 * MULTI-WORD ONLY, and that restriction is the whole design.
 *
 * `SKILL_RE` ends with `(?![A-Za-z0-9])`, so an alias cannot be followed by a
 * letter: "vector database" simply does not match "vector databases". Measured
 * against the live corpus, that silently lost "vector databases", "large
 * language models" and "REST APIs" — the last one falling back to the bare
 * alias "rest", which is worse than missing it. The entries that did survive
 * only did so because somebody had hand-written the plural as an alias
 * ("data pipelines"), which is 632 entries' worth of work nobody will finish.
 *
 * Pluralising SINGLE words would be a net loss. "excel" would match "excels at
 * communication", "word" would match the word "words", "dart" would match
 * darts. Those are ordinary English, and a false skill is worse than a missing
 * one: it goes into `skills_required` and changes who gets matched to the job.
 *
 * A multi-word technical phrase plus an s carries no such risk — nothing says
 * "large language models" except someone talking about large language models.
 * Every miss the corpus actually showed was multi-word, so the safe half of
 * the rule is also the whole of the benefit.
 */
function pluralOf(alias: string): string | null {
  if (!/[ -]/.test(alias)) return null;
  const last = alias.split(/[ -]/).pop() ?? "";
  // Already plural, or not a word we can inflect.
  if (!/^[a-z]{3,}$/.test(last) || last.endsWith("s")) return null;
  if (/(?:x|z|ch|sh)$/.test(last)) return `${alias}es`;
  if (/[^aeiou]y$/.test(last)) return `${alias.slice(0, -1)}ies`;
  return `${alias}s`;
}

function aliasVariants(alias: string): string[] {
  const out = new Set<string>([alias]);
  if (alias.includes(" ")) {
    out.add(alias.replace(/ /g, "-"));
    out.add(alias.replace(/ /g, ""));
  }
  if (alias.includes("-")) {
    out.add(alias.replace(/-/g, " "));
    out.add(alias.replace(/-/g, ""));
  }
  // Pluralise every spelling variant, so "vector-databases" and
  // "vectordatabases" are caught as well as "vector databases".
  for (const v of [...out]) {
    const p = pluralOf(v);
    if (p) out.add(p);
  }
  return [...out];
}

/**
 * Every alias, longest first, so "spring boot" wins over "spring".
 *
 * Tech and business vocabularies feed ONE matcher. Keeping them in separate
 * regexes would mean two passes with two sets of word-boundary rules, and the
 * longest-alias-wins ordering could not be enforced across both — "monday.com"
 * would lose to "monday".
 */
const ALIAS_ROWS: readonly AliasRow[] = (() => {
  const seen = new Set<string>();
  const rows: AliasRow[] = [];
  const all = [
    ...SKILLS.map((s) => ({ ...s, ambiguousSet: AMBIGUOUS })),
    ...BUSINESS_SKILLS.map((s) => ({ ...s, ambiguousSet: BUSINESS_AMBIGUOUS })),
  ];
  for (const s of all) {
    for (const a of [s.term, ...s.aliases]) {
      const key = a.toLowerCase().trim();
      for (const v of aliasVariants(key)) {
        if (!v || seen.has(v)) continue;
        seen.add(v);
        rows.push({
          alias: v,
          term: SKILL_INDEX.get(key) ?? s.term,
          ambiguous: s.ambiguousSet.has(v) || s.ambiguousSet.has(s.term),
        });
      }
    }
  }
  return rows.sort((a, b) => b.alias.length - a.alias.length);
})();

const SKILL_RE = new RegExp(
  `(?<![A-Za-z0-9+#.])(?:${ALIAS_ROWS.map((r) => escapeRe(r.alias)).join("|")})(?![A-Za-z0-9])`,
  "gi",
);

const ALIAS_TO_TERM = new Map(ALIAS_ROWS.map((r) => [r.alias, r.term]));
const AMBIGUOUS_ALIASES = new Set(
  ALIAS_ROWS.filter((r) => r.ambiguous).map((r) => r.alias),
);

/**
 * An ambiguous alias ("go", "c", "rust") only counts as a skill when it sits in
 * a list or next to an explicit skill word, so "go to market" and "R&D" do not
 * poison the stack.
 */
const LIST_NEIGHBOUR = /[,;/|\u2022\n()[\]]/;
const SKILL_CONTEXT =
  /(experience|proficien|knowledge|skills?|programming|language|develop|hands[- ]on|\u05e0\u05d9\u05e1\u05d9\u05d5\u05df|\u05e9\u05dc\u05d9\u05d8\u05d4|\u05d9\u05d3\u05e2|\u05e4\u05d9\u05ea\u05d5\u05d7)/i;

/**
 * Whether a match sits at a real word boundary in Hebrew.
 *
 * `SKILL_RE`'s lookarounds are `(?<![A-Za-z0-9+#.])` and `(?![A-Za-z0-9])` —
 * ASCII only, which is the same trap `\b` sets and the reason `text.ts` exists
 * at all. Two consequences, in opposite directions:
 *
 *   - `ניסיון בפייתון` did not yield `python`. The alias is `פייתון`, the ב־
 *     prefix is a clitic glued to the front, and an ASCII lookbehind sees a
 *     Hebrew letter and does not care — but nothing folded the clitic away
 *     either, so the alias simply never matched as written.
 *   - An alias occurring INSIDE a longer Hebrew word matched happily, because
 *     a Hebrew letter on either side is invisible to `[A-Za-z0-9]`.
 *
 * This applies the clitic rule from `text.ts:17-35`: a Hebrew letter before
 * the match is acceptable only when it is one of the seven one-letter clitics
 * (ב ל מ ו ה ש כ) AND is itself at a word boundary. A Hebrew letter after the
 * match is never acceptable.
 *
 * Latin matches are unaffected — the regex lookarounds already handle those,
 * and this returns true for anything with no Hebrew neighbour.
 */
const HE_LETTER = /[א-ת]/;
const HE_CLITIC = /[בלמוהשכ]/;

export function hebrewBoundaryOk(text: string, idx: number, len: number): boolean {
  const after = text[idx + len] ?? "";
  if (HE_LETTER.test(after)) return false;

  /*
   * Walk back over up to TWO clitics. Hebrew stacks them: `ובאנגולר` is
   * ו + ב + אנגולר, "and in Angular", and it is how a list of technologies is
   * ordinarily written. Allowing only one silently dropped every skill after
   * the first in a Hebrew list.
   *
   * Two is the practical limit — ומה, ושב and friends are three letters but
   * are words rather than stacked clitics — and stopping there keeps this from
   * eating into real words.
   */
  let at = idx - 1;
  for (let skipped = 0; skipped < 2; skipped++) {
    const ch = text[at] ?? "";
    if (!HE_LETTER.test(ch)) return true; // reached a real word boundary
    if (!HE_CLITIC.test(ch)) return false; // a Hebrew letter that is not a clitic
    at--;
  }
  // Three or more Hebrew letters before the match: part of a longer word.
  return !HE_LETTER.test(text[at] ?? "");
}

function ambiguousAccepted(text: string, idx: number, len: number): boolean {
  const left = text.slice(Math.max(0, idx - 40), idx);
  const right = text.slice(idx + len, idx + len + 40);
  if (LIST_NEIGHBOUR.test(left.slice(-3)) || LIST_NEIGHBOUR.test(right.slice(0, 3))) {
    return true;
  }
  if (SKILL_CONTEXT.test(left) || SKILL_CONTEXT.test(right)) return true;
  return /[a-z0-9+#]\s*[/,]\s*$/i.test(left);
}

/** Extract canonical skill terms from a block of text, in first-seen order. */
export function extractSkills(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  SKILL_RE.lastIndex = 0;
  for (let m = SKILL_RE.exec(text); m !== null; m = SKILL_RE.exec(text)) {
    const alias = m[0].toLowerCase();
    const term = ALIAS_TO_TERM.get(alias);
    if (!term) continue;
    // SKILL_RE's lookarounds are ASCII-only, so a Hebrew neighbour is
    // invisible to them. See hebrewBoundaryOk.
    if (!hebrewBoundaryOk(text, m.index, m[0].length)) continue;
    if (AMBIGUOUS_ALIASES.has(alias) && !ambiguousAccepted(text, m.index, m[0].length)) {
      continue;
    }
    if (seen.has(term)) continue;
    seen.add(term);
    found.push(term);
  }
  return found;
}

/* ------------------------------------------------------------------------- */
/* location                                                                   */
/* ------------------------------------------------------------------------- */

interface CityTerm {
  term: string;
  city: CityEntry;
}

const CITY_TERMS: readonly CityTerm[] = CITIES.flatMap((city) =>
  // normalizeHe(), not toLowerCase(): resolveLocation() searches a normalized
  // haystack, so `ראשון לציון` has to be stored as `ראשונ לציונ`.
  [city.en, city.he, ...city.aliases].map((t) => ({ term: normalizeHe(t), city })),
).sort((a, b) => b.term.length - a.term.length);

const ABROAD_ALIASES: readonly string[] = ABROAD_TERMS.flatMap((t) =>
  t.aliases.map((a) => a.toLowerCase()),
).sort((a, b) => b.length - a.length);

/**
 * Resolve the cities named in `locationRaw` (and, as a fallback, in the head of
 * the description). Multiple cities go to `cities[]`; `city` is the first one,
 * which is the one the ATS lists first in practice.
 */
/**
 * The part of a job title where a location is conventionally written.
 *
 * "Site Reliability Engineer — UK", "Data Labeling Associate (Portugal)",
 * "Backend Developer, Berlin". A country in that slot is the employer saying
 * where the job is.
 *
 * A country name ELSEWHERE in a title is usually part of a company name —
 * "Germany Trade & Invest", "American Express", "China Telecom" — and treating
 * that as a location would throw away real Israeli jobs at those employers.
 * Hence position matters, not mere presence.
 */
function locationSlots(title: string): string[] {
  const t = title.trim();
  if (!t) return [];
  const slots: string[] = [];
  for (const m of t.matchAll(/[([]([^)\]]{1,40})[)\]]/g)) slots.push(m[1]);
  const tail = t.split(/[—–|,-]/).slice(1).join(" ");
  if (tail) slots.push(tail);
  return slots;
}

/**
 * A United States location, recognised ONLY inside a structured location field.
 *
 * ATS feeds write places in shapes no country list will ever cover:
 *
 *     "Honolulu, HI (onsite)"        a two-letter state after a comma
 *     "US-CA-Menlo Park"             Amazon and Meta style
 *     "Somerville, MA, Global HQ"
 *     "Washington, D.C."
 *
 * Both reported misses were of this shape. Adding city names one at a time is a
 * losing game; the state code is the reliable token, and after a comma in a
 * structured field it is unambiguous.
 *
 * Deliberately NOT applied to the description body. In prose ", in" is Indiana
 * and also the word "in", ", or" is Oregon and also "or". The structured field
 * has no prose, which is what makes this safe — and `strongIsrael` still
 * outranks it, so "Tel Aviv, IL" is never mistaken for Illinois.
 */
const US_STATE_AFTER_COMMA =
  /,\s*(a[lkzr]|c[aot]|de|fl|ga|hi|i[dln]|[km][sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy]|d\.?c\.?)\b/;
const US_PREFIX = /(?:^|[\s,(])us-[a-z]{2}-/;
const US_BARE = /(?:^|[\s,(])(?:usa|u\.s\.a?\.?|united states)(?:[\s,)]|$)/;

/**
 * Remove the state code from an `US-XX-City` prefix before looking for Israel.
 *
 * `ISRAEL_ALIASES` contains `"il"`, the ISO code. In `US-IL-Chicago` that same
 * token is ILLINOIS, and both its neighbours are hyphens — so the
 * boundary-aware matcher finds a clean "il" and `strongIsrael` goes true. The
 * US prefix is detected correctly two lines above and then loses to a false
 * Israel hit inside itself.
 *
 * This is not hypothetical. It is the shape that put foreign jobs in the index
 * and survived an audit: the audit read `location.country`, which defaults to
 * `IL`, and the decomposition had already decided Chicago was Israeli.
 *
 * Only the `us-XX-` prefix is stripped, and only where `usPlace` would match
 * it, so a genuine "Tel Aviv, IL" is untouched.
 */
function dropUsState(s: string): string {
  return s.replace(/(^|[\s,(])us-[a-z]{2}-/g, "$1us-");
}

function usPlace(structured: string): string | null {
  if (!structured) return null;
  if (US_PREFIX.test(structured)) return "United States";
  if (US_BARE.test(structured)) return "United States";
  if (US_STATE_AFTER_COMMA.test(structured)) return "United States";
  return null;
}

export function resolveLocation(
  locationRaw: string | null | undefined,
  descriptionText = "",
  titleRaw = "",
): { location: JobLocation; conf: number } {
  const raw = locationRaw?.trim() || null;
  const hay = normalizeHe(`${raw ?? ""}\n${descriptionText.slice(0, 1200)}`);
  const locHay = raw ? normalizeHe(raw) : "";

  const hits: CityEntry[] = [];
  for (const scope of [locHay, hay]) {
    if (!scope) continue;
    const claimed: Array<[number, number]> = [];
    for (const { term, city } of CITY_TERMS) {
      const idx = findTerm(scope, term);
      if (idx < 0) continue;
      // longest-first order means an overlap is always a shorter substring
      if (claimed.some(([s, e]) => idx < e && idx + term.length > s)) continue;
      claimed.push([idx, idx + term.length]);
      if (!hits.some((c) => c.en === city.en)) hits.push(city);
    }
    if (hits.length) break;
  }

  const abroadHit = ABROAD_ALIASES.find((a) => hasCue(hay, a)) ?? null;
  const israelHit = ISRAEL_ALIASES.some((a) => hasCue(hay, a.toLowerCase()));

  /*
   * A foreign country stated in the STRUCTURED location field, or in the
   * location slot of the title, outranks an Israeli city found in the body.
   *
   * Without this, abroad was only ever considered when no Israeli city turned
   * up anywhere — so "Site Reliability Engineer, Infrastructure Platforms — UK"
   * stayed in an Israeli index because its description mentioned the company's
   * Tel Aviv office. The body tells you where the employer is; the title and
   * the location field tell you where the JOB is.
   */
  const strongScopes = [locHay, ...locationSlots(titleRaw).map((x) => normalizeHe(x))].filter(Boolean);
  const strongAbroad =
    strongScopes.length > 0
      ? (ABROAD_ALIASES.find((a) => strongScopes.some((sc) => hasCue(sc, a))) ??
        usPlace(locHay))
      : null;
  const strongIsrael =
    strongScopes.some((sc) => ISRAEL_ALIASES.some((a) => hasCue(dropUsState(sc), a.toLowerCase()))) ||
    strongScopes.some((sc) => CITY_TERMS.some(({ term }) => findTerm(sc, term) >= 0));

  if (strongAbroad && !strongIsrael) {
    return {
      location: {
        raw,
        city: null,
        cities: [],
        region: "abroad",
        lat: null,
        lng: null,
        country: "XX",
        abroad: true,
      },
      conf: 0.75,
    };
  }

  if (hits.length === 0 && abroadHit && !israelHit) {
    return {
      location: {
        raw,
        city: null,
        cities: [],
        region: "abroad",
        lat: null,
        lng: null,
        country: "XX",
        abroad: true,
      },
      conf: 0.7,
    };
  }

  if (hits.length === 0) {
    return {
      location: {
        raw,
        city: null,
        cities: [],
        region: null,
        lat: null,
        lng: null,
        country: "IL",
        abroad: false,
      },
      conf: israelHit ? 0.5 : 0.1,
    };
  }

  const primary = hits[0]!;
  return {
    location: {
      raw,
      city: primary.en,
      cities: hits.map((c) => c.en),
      region: primary.region,
      lat: primary.lat,
      lng: primary.lng,
      country: "IL",
      abroad: false,
    },
    conf: raw ? 0.95 : 0.6,
  };
}

/* ------------------------------------------------------------------------- */
/* title                                                                      */
/* ------------------------------------------------------------------------- */

const SENIORITY_STRIP: readonly string[] = [
  "senior", "sr.", "sr", "junior", "jr.", "jr", "staff", "principal", "lead",
  "entry level", "entry-level", "experienced", "expert", "chief", "head of",
  "בכיר", "בכירה", "זוטר", "ג'וניור", "סניור", "מנוסה",
];

const NOISE_TOKENS: readonly string[] = [
  "hybrid", "remote", "onsite", "on-site", "on site", "full time", "full-time",
  "part time", "part-time", "temporary", "contract", "internship", "intern",
  "relocation", "urgent", "hot", "new", "hiring", "we are hiring", "open position",
  "m/f", "m/f/d", "f/m/d", "m/w/d", "all genders",
  "היברידי", "היברידית", "מהבית", "עבודה מהבית", "מרחוק", "משרה מלאה",
  "משרה חלקית", "דרוש", "דרושה", "דרושים", "מיידי", "חדש", "מגייסים",
];

/**
 * PLAN.md 5.2 `title_norm`: strip seniority words, parenthesised tech, gender
 * suffixes and trailing locations.
 */
export function normalizeTitle(titleRaw: string, cities: readonly string[] = []): string {
  let t = collapseGenderForms(stripHtml(titleRaw));

  // parenthesised / bracketed decorations: "(Node.js)", "[TLV]"
  t = t.replace(/[([{][^)\]}]*[)\]}]/g, " ");
  t = t.replace(/\b(?:req|job|id|ref)\s*#?\s*[a-z0-9-]{2,}\b/gi, " ");
  t = t.replace(/#\s*\d+/g, " ");

  // trailing location / noise after a dash, comma, pipe or slash
  const tail = /\s*[-\u2013\u2014|,/]\s*[^-\u2013\u2014|,/]{2,40}$/;
  for (let i = 0; i < 3; i++) {
    const m = t.match(tail);
    if (!m) break;
    const seg = normalizeHe(m[0].replace(/^[\s\-\u2013\u2014|,/]+/, ""));
    const droppable =
      cities.some((c) => hasCue(seg, c.toLowerCase())) ||
      CITY_TERMS.some(({ term }) => hasCue(seg, term)) ||
      ISRAEL_ALIASES.some((a) => hasCue(seg, a.toLowerCase())) ||
      NOISE_TOKENS.some((n) => hasCue(seg, n));
    if (!droppable) break;
    t = t.slice(0, t.length - m[0].length);
  }

  let n = normalizeHe(t);
  for (const rawCue of [...NOISE_TOKENS, ...SENIORITY_STRIP]) {
    const w = foldCue(rawCue);
    for (;;) {
      const i = findTerm(n, w);
      if (i < 0) break;
      n = `${n.slice(0, i)} ${n.slice(i + w.length)}`;
    }
  }

  return n
    .replace(/[\s\-\u2013\u2014|,/]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s.\u00b7\u2022:]+|[\s.\u00b7\u2022:]+$/g, "")
    .trim();
}

/* ------------------------------------------------------------------------- */
/* function                                                                   */
/* ------------------------------------------------------------------------- */

export interface FunctionResult {
  fn: JobFunction;
  subFunction: string | null;
  conf: number;
}

/** Weighted keyword vote: title cues 3x, body cues 1x (capped at 4 hits). */
export function classifyFunction(titleNorm: string, body: string): FunctionResult {
  const t = titleNorm;
  const b = normalizeHe(body).slice(0, 6000);

  let best: { fn: JobFunction; score: number } | null = null;
  let runnerUp = 0;

  for (const def of FUNCTION_DEFS) {
    let score = 0;
    for (const cue of def.title) if (hasCue(t, cue)) score += 3;
    let bodyHits = 0;
    for (const cue of def.body) {
      if (hasCue(b, cue)) bodyHits++;
      if (bodyHits >= 4) break;
    }
    score += bodyHits;
    if (score === 0) continue;
    if (!best || score > best.score) {
      if (best) runnerUp = Math.max(runnerUp, best.score);
      best = { fn: def.fn, score };
    } else {
      runnerUp = Math.max(runnerUp, score);
    }
  }

  if (!best) return { fn: "non_tech", subFunction: null, conf: 0.2 };

  const margin = best.score - runnerUp;
  const conf = Math.min(0.95, 0.4 + best.score * 0.06 + Math.max(0, margin) * 0.05);

  let subFunction: string | null = null;
  if (best.fn === "software_engineering") {
    for (const [sub, cues] of SUB_FUNCTIONS) {
      if (cues.some((c) => hasCue(t, c))) {
        subFunction = sub;
        break;
      }
    }
    if (!subFunction) {
      for (const [sub, cues] of SUB_FUNCTIONS) {
        if (cues.some((c) => hasCue(b, c))) {
          subFunction = sub;
          break;
        }
      }
    }
  }

  return { fn: best.fn, subFunction, conf };
}

/* ------------------------------------------------------------------------- */
/* seniority                                                                  */
/* ------------------------------------------------------------------------- */

const SENIORITY_TITLE_CUES: ReadonlyArray<readonly [Seniority, readonly string[]]> = [
  [
    "student",
    ["student", "intern", "internship", "trainee", "apprentice",
      "סטודנט", "סטודנטית", "מתמחה", "התמחות", "משרת סטודנט"],
  ],
  [
    "exec",
    ["cto", "ceo", "cio", "ciso", "cpo", "coo", "cfo", "cro", "chief",
      "vp", "vice president", "evp", "svp", "general manager",
      "סמנכל", "מנכל", "משנה למנכל"],
  ],
  [
    "director",
    ["director", "head of", "group manager", "senior director",
      "ראש תחום", "ראש אגף", "מנהל אגף", "מנהל תחום"],
  ],
  [
    "manager",
    ["manager", "engineering manager", "r&d manager", "development manager",
      "מנהל פיתוח", "מנהל מחלקה", "מנהל קבוצה"],
  ],
  [
    "lead",
    ["lead", "team lead", "tech lead", "technical lead", "staff", "principal",
      "architect", "ראש צוות", "טים ליד", "מוביל צוות", "ארכיטקט"],
  ],
  ["senior", ["senior", "sr.", "sr", "בכיר", "סניור"]],
  [
    "junior",
    ["junior", "jr.", "jr", "entry level", "entry-level", "graduate",
      "ג'וניור", "זוטר", "מתחיל", "ללא ניסיון"],
  ],
];

/** `5-7 years`, `3+ שנות ניסיון`, `2 שנים` */
const YEARS_RE =
  /(\d{1,2})\s*(?:\+|plus)?\s*(?:[-\u2013\u2014]|to|עד)?\s*(\d{1,2})?\s*(?:\+)?\s*(?:years?|yrs?|שנות\s+ניסיון|שנים|שנה)/gi;

/** Hebrew number words that appear instead of digits. */
const HE_YEAR_WORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/שנתיים/, 2],
  [/שלוש\s+שנים/, 3],
  [/ארבע\s+שנים/, 4],
  [/חמש\s+שנים/, 5],
  [/שש\s+שנים/, 6],
  [/שבע\s+שנים/, 7],
  [/שמונה\s+שנים/, 8],
  [/עשר\s+שנים/, 10],
];

export interface SeniorityResult {
  seniority: Seniority | null;
  reqYearsMin: number | null;
  reqYearsMax: number | null;
  conf: number;
  src: FieldSource;
}

/**
 * Words that make a nearby year count the requirement for the WHOLE role.
 *
 * "5+ years of experience" is the ask. "2 years of React" is a detail about
 * one skill inside it.
 */
const YEARS_STRONG = /experience|experienced|ניסיון|ותק/i;

/** A year figure that is not a requirement at all. */
const YEARS_PAST = /\b(?:ago|old)\b|לפני/i;

/**
 * Years of experience asked for.
 *
 * ## Why this is not simply the smallest number in the text
 *
 * It used to be. "5+ years backend experience, 2 years React" returned **2**,
 * so a senior role was classified as mid-level, and the seniority filter put
 * it in front of the wrong people. It is the most consequential single field
 * decomposition produces — it drives `seniority`, the match score and the
 * junior-friendly filter — and it was being decided by whichever incidental
 * figure in the posting happened to be lowest.
 *
 * A listing mentions years for several different reasons. The fix is to score
 * each mention by how much it looks like the role's actual requirement, and
 * take the best one rather than the smallest:
 *
 *   +2  sits near "experience" / "ניסיון" — the phrase that names a requirement
 *   +1  appears early, where requirements are stated
 *   −2  a skill name follows on the same line ("2 years of React")
 *   −3  followed by "ago" or "old" ("founded 8 years ago")
 *
 * Ties break toward the LARGER figure. Within an equally-plausible pair, the
 * bigger number is nearly always the role-level ask and the smaller one a
 * per-skill aside — and under-stating a requirement sends juniors to apply for
 * senior roles, which wastes their time rather than ours.
 */
export function extractYears(body: string): { min: number | null; max: number | null } {
  const text = body.slice(0, 8000);

  let best: { min: number; max: number | null; score: number } | null = null;

  YEARS_RE.lastIndex = 0;
  for (let m = YEARS_RE.exec(text); m !== null; m = YEARS_RE.exec(text)) {
    const a = Number.parseInt(m[1]!, 10);
    const b = m[2] ? Number.parseInt(m[2], 10) : null;
    if (!Number.isFinite(a) || a > 30) continue;

    // The line this match sits on, and a little either side of it.
    const from = Math.max(0, m.index - 60);
    const to = Math.min(text.length, m.index + m[0].length + 60);
    const around = text.slice(from, to);
    const after = text.slice(m.index + m[0].length, to);

    let score = 0;
    if (YEARS_STRONG.test(around)) score += 2;
    if (m.index < 600) score += 1;
    if (YEARS_PAST.test(after.slice(0, 20))) score -= 3;
    /*
     * "2 years of React" — a named technology right after the figure means
     * this is a per-skill aside, not the role's requirement. `skillsIn` is
     * cheap here because `after` is at most 60 characters.
     */
    if (extractSkills(after).length > 0) score -= 2;

    const max = b !== null && b <= 40 && b >= a ? b : null;
    if (best === null || score > best.score || (score === best.score && a > best.min)) {
      best = { min: a, max, score };
    }
  }

  if (best) return { min: best.min, max: best.max };

  for (const [re, n] of HE_YEAR_WORDS) {
    if (re.test(text)) return { min: n, max: null };
  }
  return { min: null, max: null };
}

/**
 * PLAN.md 5.2 `seniority`: title cues beat the years regex; 0-1 junior,
 * 2-4 mid, 5-7 senior, 8+ senior (lead only when the title says so).
 */
export function classifySeniority(titleNorm: string, body: string): SeniorityResult {
  const years = extractYears(body);

  for (const [level, cues] of SENIORITY_TITLE_CUES) {
    if (cues.some((c) => hasCue(titleNorm, c))) {
      return {
        seniority: level,
        reqYearsMin: years.min,
        reqYearsMax: years.max,
        conf: 0.9,
        src: "rule",
      };
    }
  }

  if (years.min === null) {
    return { seniority: null, reqYearsMin: null, reqYearsMax: null, conf: 0.2, src: "rule" };
  }

  const y = years.min;
  const seniority: Seniority = y <= 1 ? "junior" : y <= 4 ? "mid" : "senior";
  return {
    seniority,
    reqYearsMin: years.min,
    reqYearsMax: years.max,
    conf: 0.75,
    src: "rule",
  };
}

/* ------------------------------------------------------------------------- */
/* remote                                                                     */
/* ------------------------------------------------------------------------- */

const HYBRID_CUES = ["היברידי", "היברידית", "היברידיות", "hybrid"];
const REMOTE_CUES = [
  "מהבית", "עבודה מהבית", "עבודה מרחוק", "מרחוק", "remote", "wfh",
  "work from home", "work from anywhere", "telecommute",
];
const STRONG_REMOTE_CUES = [
  "fully remote", "100% remote", "remote-first", "remote first",
  "עבודה מלאה מהבית", "עבודה מרחוק מלאה",
];
const OFFICE_CUES = [
  "במשרד", "במשרדים", "מהמשרד", "in office", "in the office", "on-site",
  "onsite", "on site", "from our office", "office based",
];

/** `3 ימים במשרד`, `2 days in office`, `יומיים במשרד` */
/** `3 ימים במשרד`, `2 days in office`, `יומיים במשרד`. String.raw keeps the
 *  regex escapes intact; heRe() folds the Hebrew finals to match normalizeHe(). */
const DAYS_DIGIT_RE = heRe(
  String.raw`(\d)\s*(?:ימים|ימי|days?)\s*(?:[\w'’]+\s+){0,3}?(?:במשרד|במשרדים|in\s+(?:the\s+)?office|onsite|on[- ]site|from\s+the\s+office|office)`,
);
const DAYS_REVERSE_RE = heRe(
  String.raw`(?:במשרד|in\s+(?:the\s+)?office|onsite|on[- ]site)\s*(?:[\w'’]+\s+){0,3}?(\d)\s*(?:ימים|days?)`,
);
const HE_DAY_WORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [heRe(String.raw`יום\s+אחד\s+במשרד`), 1],
  [heRe(String.raw`יומיים\s+במשרד`), 2],
  [heRe(String.raw`(?:שלושה|3)\s+ימים\s+במשרד`), 3],
  [heRe(String.raw`(?:ארבעה|4)\s+ימים\s+במשרד`), 4],
  [heRe(String.raw`(?:חמישה|5)\s+ימים\s+במשרד`), 5],
];

export interface RemoteResult {
  remote: RemoteMode;
  hybridDaysOffice: number | null;
  conf: number;
}

export function classifyRemote(text: string, hasCity: boolean): RemoteResult {
  const t = normalizeHe(text);

  let days: number | null = null;
  const m = DAYS_DIGIT_RE.exec(t) ?? DAYS_REVERSE_RE.exec(t);
  if (m) {
    const n = Number.parseInt(m[1]!, 10);
    if (n >= 1 && n <= 6) days = n;
  }
  if (days === null) {
    for (const [re, n] of HE_DAY_WORDS) {
      if (re.test(t)) {
        days = n;
        break;
      }
    }
  }

  if (STRONG_REMOTE_CUES.some((c) => hasCue(t, c))) {
    return { remote: "remote", hybridDaysOffice: null, conf: 0.95 };
  }
  if (HYBRID_CUES.some((c) => hasCue(t, c))) {
    return { remote: "hybrid", hybridDaysOffice: days, conf: 0.9 };
  }
  if (days !== null && days < 5) {
    return { remote: "hybrid", hybridDaysOffice: days, conf: 0.85 };
  }

  const remoteCue = REMOTE_CUES.some((c) => hasCue(t, c));
  const officeCue = OFFICE_CUES.some((c) => hasCue(t, c));
  if (remoteCue && !officeCue) {
    return { remote: "remote", hybridDaysOffice: null, conf: 0.75 };
  }
  if (remoteCue && officeCue) {
    return { remote: "hybrid", hybridDaysOffice: days, conf: 0.5 };
  }
  if (hasCity) return { remote: "onsite", hybridDaysOffice: null, conf: 0.5 };
  /*
   * An office cue with no remote cue and no city is still on-site.
   *
   * This was falling through to `unknown`, so "you will work from our office"
   * on a posting whose location field we could not resolve told the reader
   * nothing — despite the posting saying it outright. Lower confidence than
   * the city path, because that one has a second, structured signal agreeing.
   */
  if (officeCue) return { remote: "onsite", hybridDaysOffice: null, conf: 0.45 };
  return { remote: "unknown", hybridDaysOffice: null, conf: 0.2 };
}

/* ------------------------------------------------------------------------- */
/* languages / education / clearance / employment type                        */
/* ------------------------------------------------------------------------- */

const ENGLISH_REQUIRED_CUES = [
  "אנגלית ברמה גבוהה",
  "אנגלית ברמת שפת אם",
  "אנגלית שוטפת",
  "אנגלית מצוינת",
  "שליטה מלאה באנגלית",
  "fluent english",
  "fluent in english",
  "english - high level",
  "english high level",
  "excellent english",
  "native english",
  "strong english",
  "proficient in english",
  "english proficiency",
];
const ENGLISH_ADVANTAGE_CUES = [
  "אנגלית יתרון",
  "english is an advantage",
  "english - advantage",
];
const ENGLISH_TEAM_CUES = [
  "english speaking team",
  "english-speaking team",
  "working language is english",
  "צוות דובר אנגלית",
  "שפת העבודה היא אנגלית",
];

export function classifyLanguages(text: string, lang: "he" | "en" | "mixed"): Languages {
  const t = normalizeHe(text);
  let english: Languages["english"] = "none";
  if (ENGLISH_REQUIRED_CUES.some((c) => hasCue(t, c))) english = "required";
  else if (ENGLISH_ADVANTAGE_CUES.some((c) => hasCue(t, c))) english = "advantage";
  else if (lang === "en") english = "required";

  const englishOnlyTeam = ENGLISH_TEAM_CUES.some((c) => hasCue(t, c));
  const hebrew: Languages["hebrew"] =
    (lang === "he" || lang === "mixed") && !englishOnlyTeam ? "required" : "none";

  return { hebrew, english };
}

const BSC_CUES = ["תואר ראשון", "תואר אקדמי", "b.sc", "bsc", "b.a", "bachelor", "בוגר תואר"];
const MSC_CUES = ["תואר שני", "m.sc", "msc", "master", "mba"];
const PHD_CUES = ["דוקטורט", "ph.d", "phd", "doctorate", "post-doc"];
const REQUIRED_WORDS = ["חובה", "נדרש", "required", "must"];
const ADVANTAGE_WORDS = ["יתרון", "advantage", "preferred", "a plus", "nice to have"];

export function classifyEducation(text: string): Education {
  // normalizeHe() collapses newlines, so normalize per line and keep the line
  // structure: "תואר ראשון - חובה" and "אנגלית - יתרון" must not be conflated.
  const lines = text.split("\n").map(normalizeHe).filter(Boolean);
  const t = lines.join(" ");
  const near = (cues: readonly string[], words: readonly string[]) =>
    lines.some(
      (l) => cues.some((c) => hasCue(l, c)) && words.some((w) => hasCue(l, w)),
    );

  if (PHD_CUES.some((c) => hasCue(t, c))) return "phd";
  if (MSC_CUES.some((c) => hasCue(t, c)) && near(MSC_CUES, REQUIRED_WORDS)) {
    return "msc_required";
  }
  if (!BSC_CUES.some((c) => hasCue(t, c))) return "none";
  // PLAN.md 5.2 lists the "חובה / required" rule first: an explicit
  // requirement beats an "advantage" word elsewhere on the same line.
  if (near(BSC_CUES, REQUIRED_WORDS)) return "bsc_required";
  if (near(BSC_CUES, ADVANTAGE_WORDS)) return "bsc_advantage";
  return "bsc_advantage";
}

const CLEARANCE_CUES = [
  "סיווג ביטחוני",
  "סיווג בטחוני",
  "מערכת הביטחון",
  "מערכת הבטחון",
  "security clearance",
  "top secret",
  "ts/sci",
  "עמידה בסיווג",
];

export function classifyClearance(text: string): boolean {
  const t = normalizeHe(text);
  return CLEARANCE_CUES.some((c) => hasCue(t, c));
}

const EMPLOYMENT_CUES: ReadonlyArray<readonly [EmploymentType, readonly string[]]> = [
  ["internship", ["internship", "intern", "התמחות", "מתמחה"]],
  ["student", ["student position", "משרת סטודנט", "סטודנט", "סטודנטית", "student job"]],
  ["part_time", ["part time", "part-time", "משרה חלקית", "חצי משרה"]],
  ["freelance", ["freelance", "freelancer", "פרילנס", "פרילנסר"]],
  ["contract", ["contract", "contractor", "temporary", "fixed term", "חוזה", "קבלן", "זמני"]],
];

export function classifyEmploymentType(text: string, feedHint?: string | null): EmploymentType {
  const t = normalizeHe(`${feedHint ?? ""}\n${text}`);
  for (const [type, cues] of EMPLOYMENT_CUES) {
    if (cues.some((c) => hasCue(t, c))) return type;
  }
  return "full_time";
}

/* ------------------------------------------------------------------------- */
/* salary                                                                     */
/* ------------------------------------------------------------------------- */

const SALARY_CONTEXT =
  /(שכר|משכורת|תגמול|salary|compensation|base\s+pay|pay\s+range|monthly)/i;

const NUM = String.raw`\d{1,3}(?:[,.\s]\d{3})*(?:\.\d+)?`;

interface SalaryPattern {
  re: RegExp;
  currency: Salary["currency"];
  /** true when the numbers are written in thousands ("28-35K"). */
  thousands: boolean;
  requireContext: boolean;
}

const ILS_MARK = String.raw`(?:₪|ils|nis|ש"ח|ש״ח|שח)`;

const SALARY_PATTERNS: readonly SalaryPattern[] = [
  {
    re: new RegExp(
      `${ILS_MARK}\\s*(${NUM})\\s*(?:[-\u2013\u2014]|to|עד)\\s*(${NUM})|(${NUM})\\s*(?:[-\u2013\u2014]|to|עד)\\s*(${NUM})\\s*${ILS_MARK}`,
      "i",
    ),
    currency: "ILS",
    thousands: false,
    requireContext: false,
  },
  {
    re: new RegExp(`${ILS_MARK}\\s*(${NUM})|(${NUM})\\s*${ILS_MARK}`, "i"),
    currency: "ILS",
    thousands: false,
    requireContext: false,
  },
  // 28-35K / 28K-35K — Israeli monthly shorthand, needs salary context
  {
    re: /(\d{1,3})\s*k?\s*(?:[-\u2013\u2014]|to|עד)\s*(\d{1,3})\s*k\b/i,
    currency: "ILS",
    thousands: true,
    requireContext: true,
  },
  {
    re: new RegExp(String.raw`\$\s*(${NUM})\s*(?:[-\u2013\u2014]|to)\s*\$?\s*(${NUM})`, "i"),
    currency: "USD",
    thousands: false,
    requireContext: false,
  },
  {
    re: new RegExp(String.raw`€\s*(${NUM})\s*(?:[-\u2013\u2014]|to)\s*€?\s*(${NUM})`, "i"),
    currency: "EUR",
    thousands: false,
    requireContext: false,
  },
];

const ANNUAL_CUES = /(per\s+year|annually|annual|\/\s*yr|per\s+annum|לשנה|שנתי)/i;
const HOURLY_CUES = /(per\s+hour|hourly|\/\s*hr|לשעה|שכר\s+שעתי)/i;

function toNumber(s: string): number {
  return Number.parseFloat(s.replace(/[,\s]/g, ""));
}

/**
 * PLAN.md 5.2 `salary`. Explicit numbers only — never estimated, never
 * converted between currencies (FX belongs to the nightly SQL job, 5.4).
 */
export function extractSalary(text: string, feedSalaryRaw?: string | null): Salary | null {
  const scopes: Array<{ s: string; fromFeed: boolean }> = [];
  if (feedSalaryRaw) scopes.push({ s: feedSalaryRaw, fromFeed: true });
  if (text) scopes.push({ s: text, fromFeed: false });

  for (const { s: scope, fromFeed } of scopes) {
    const hasContext = fromFeed || SALARY_CONTEXT.test(scope);
    for (const p of SALARY_PATTERNS) {
      if (p.requireContext && !hasContext) continue;
      const m = p.re.exec(scope);
      if (!m) continue;

      const nums = m.slice(1).filter((x): x is string => typeof x === "string");
      if (nums.length === 0) continue;

      let min = toNumber(nums[0]!);
      let max = nums.length > 1 ? toNumber(nums[1]!) : null;
      if (!Number.isFinite(min)) continue;
      if (p.thousands) {
        min *= 1000;
        if (max !== null) max *= 1000;
      }
      if (max !== null && (!Number.isFinite(max) || max < min)) max = null;

      const window = scope.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
      const period: Salary["period"] = HOURLY_CUES.test(window)
        ? "hour"
        : ANNUAL_CUES.test(window) || (p.currency !== "ILS" && min >= 40000)
          ? "year"
          : "month";

      // A monthly ILS figure below 3,000 is almost never a salary.
      if (p.currency === "ILS" && period === "month" && min < 3000) continue;

      return { min, max, currency: p.currency, period, raw: m[0].trim(), source: "posting" };
    }
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* agency / apply method                                                      */
/* ------------------------------------------------------------------------- */

export function looksLikeAgency(text: string, companyName?: string | null): boolean {
  const name = normalizeHe(companyName ?? "");
  if (name && AGENCY_NAMES.some((a) => hasCue(name, a))) return true;

  const t = normalizeHe(text);
  if (AGENCY_STRONG_CUES.some((c) => hasCue(t, c))) return true;

  return AGENCY_WEAK_CUES.filter((c) => hasCue(t, c)).length >= 2;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const DM_CUES = ["dm me", "send me a dm", "הודעה פרטית", "שלחו הודעה", "בפרטי"];

/** Providers whose postings always link to a real ATS application form. */
export const ATS_SOURCES: ReadonlySet<string> = new Set([
  "greenhouse", "lever", "ashby", "comeet", "workable", "smartrecruiters",
  "recruitee", "workday", "personio", "bamboohr",
]);

export function classifyApplyMethod(source: string, text: string): ApplyMethod {
  if (ATS_SOURCES.has(source.toLowerCase())) return "ats";
  const t = normalizeHe(text);
  if (DM_CUES.some((c) => hasCue(t, c))) return "dm";
  if (EMAIL_RE.test(text)) return "email";
  return "link";
}

/* ------------------------------------------------------------------------- */
/* main entry point                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Decompose one posting into the PLAN.md 5.1 schema.
 *
 * `descriptionText` is expected to be plain text; HTML is tolerated and run
 * through `stripHtml` first.
 */
export function decompose(input: DecomposeInput): DecomposedJob {
  const meta: DecompMeta = {};
  const set = (field: string, conf: number, src: FieldSource = "rule") => {
    meta[field] = { conf, src };
  };

  const description = /<[a-z!/]/i.test(input.descriptionText)
    ? stripHtml(input.descriptionText)
    : input.descriptionText;
  const titleRaw = stripHtml(input.titleRaw).trim();
  const locationRaw = input.locationRaw?.trim() || null;

  const lang = detectLang(`${titleRaw}\n${locationRaw ?? ""}\n${description}`);
  set("lang", 0.85);

  // ---- location -----------------------------------------------------------
  const { location, conf: locConf } = resolveLocation(locationRaw, description, titleRaw);
  set("location", locConf, locationRaw ? "feed" : "rule");

  // ---- title --------------------------------------------------------------
  const titleNorm = normalizeTitle(titleRaw, location.cities);
  set("titleNorm", titleNorm ? 0.9 : 0.3);

  // ---- function -----------------------------------------------------------
  const fnResult = classifyFunction(
    titleNorm,
    `${titleRaw}\n${input.departmentRaw ?? ""}\n${description}`,
  );
  set("function", fnResult.conf);
  if (fnResult.subFunction) set("subFunction", 0.7);

  // ---- seniority ----------------------------------------------------------
  const sen = classifySeniority(normalizeHe(collapseGenderForms(titleRaw)), description);
  set("seniority", sen.conf, sen.src);
  if (sen.reqYearsMin !== null) set("reqYearsMin", 0.8);

  // ---- remote -------------------------------------------------------------
  const rem = classifyRemote(
    `${titleRaw}\n${locationRaw ?? ""}\n${description}`,
    location.city !== null,
  );
  set("remote", rem.conf);
  if (rem.hybridDaysOffice !== null) set("hybridDaysOffice", 0.85);

  // ---- skills -------------------------------------------------------------
  const sections = splitSections(description);
  const join = (kind: string) =>
    sections.filter((s) => s.kind === kind).flatMap((s) => s.lines).join("\n");
  const requiredText = join("required");
  const niceText = join("nice");
  const bodyText = join("body");

  const niceSet = new Set(extractSkills(niceText));
  const hasRequiredSection = requiredText.length > 0;
  // Without an explicit requirements heading, everything not flagged "nice"
  // counts as required (at lower confidence).
  const requiredSource = hasRequiredSection ? requiredText : `${titleRaw}\n${bodyText}`;
  const skillsRequired = extractSkills(requiredSource).filter((s) => !niceSet.has(s));
  const skillsNice = [...niceSet].filter((s) => !skillsRequired.includes(s));

  const techStack = [
    ...new Set([
      ...extractSkills(titleRaw),
      ...skillsRequired,
      ...skillsNice,
      ...extractSkills(description),
    ]),
  ];

  set("skillsRequired", hasRequiredSection ? 0.85 : 0.55);
  set("skillsNice", niceSet.size ? 0.8 : 0.3);
  set("techStack", techStack.length ? 0.85 : 0.2);

  // ---- everything else ----------------------------------------------------
  const languages = classifyLanguages(description, lang);
  set("languages", 0.7);

  const education = classifyEducation(description);
  set("education", education === "none" ? 0.5 : 0.8);

  const clearance = classifyClearance(description);
  set("clearance", clearance ? 0.9 : 0.6);

  const employmentType = classifyEmploymentType(
    `${titleRaw}\n${description}`,
    input.employmentTypeRaw,
  );
  set(
    "employmentType",
    input.employmentTypeRaw ? 0.9 : 0.7,
    input.employmentTypeRaw ? "feed" : "rule",
  );

  const salary = extractSalary(description, input.salaryRaw);
  if (salary) set("salary", 0.85, input.salaryRaw ? "feed" : "rule");

  const isAgency = looksLikeAgency(`${titleRaw}\n${description}`, input.companyName);
  set("isAgency", isAgency ? 0.8 : 0.7);

  const applyMethod = classifyApplyMethod(input.source, description);
  set("applyMethod", 0.9, ATS_SOURCES.has(input.source.toLowerCase()) ? "feed" : "rule");

  // ---- quality flags ------------------------------------------------------
  const qualityFlags: QualityFlag[] = [];
  if (!description.trim()) qualityFlags.push("no_description");
  else if (description.length < 400) qualityFlags.push("description_short");
  if (!location.city && !location.abroad) qualityFlags.push("no_location");
  if (!hasRequiredSection) qualityFlags.push("no_requirements");
  if (titleRaw.length > 3 && titleRaw === titleRaw.toUpperCase() && /[A-Z]/.test(titleRaw)) {
    qualityFlags.push("all_caps_title");
  }
  if (techStack.length > 30) qualityFlags.push("too_many_skills");
  if (titleRaw.length > 120) qualityFlags.push("title_too_long");

  return {
    titleRaw,
    titleNorm,
    function: fnResult.fn,
    subFunction: fnResult.subFunction,
    seniority: sen.seniority,
    reqYearsMin: sen.reqYearsMin,
    reqYearsMax: sen.reqYearsMax,
    employmentType,
    remote: rem.remote,
    hybridDaysOffice: rem.hybridDaysOffice,
    location,
    skillsRequired,
    skillsNice,
    techStack,
    languages,
    education,
    clearance,
    salary,
    isAgency,
    applyMethod,
    lang,
    qualityFlags,
    isTech: gateIsTech(fnResult.fn, input.companyIndustry, {
      techContext: input.techContext === true,
    }),
    decompVersion: DECOMP_VERSION,
    decompMeta: meta,
  };
}

export { gateIsTech as isTech, hasHebrew };
