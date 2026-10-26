/**
 * Bilingual search synonyms.
 *
 * The index is Israeli, so the same job is advertised as "Marketing Manager" by
 * one employer and "מנהל שיווק" by the next. A seeker who types one of those
 * currently sees roughly half the market and has no way of knowing it. This
 * maps the two vocabularies onto each other so either spelling finds both.
 *
 * Two strengths, deliberately separated:
 *
 *   expandQuery()  — TIGHT. Only terms that mean the same job. "marketing"
 *                    brings in "שיווק" and nothing else. Safe to fold into the
 *                    main result set, because a hit is still a real hit.
 *
 *   relatedTerms() — LOOSE. Neighbouring roles in the same field: "marketing"
 *                    reaches "growth", "content", "SEO". These are NOT the same
 *                    job, so they belong in a separate, labelled "near matches"
 *                    block, never silently mixed into the exact results.
 *
 * Matching is done on a normalised form that mirrors `normalize_he()` in SQL —
 * lowercased, final Hebrew letters folded — so a query typed with a final mem
 * still matches a group written with a medial one.
 */

/** Mirror of the SQL `normalize_he`: lowercase and fold Hebrew final forms. */
import { collapseGenderForms } from "./normalize";

const FINALS: Record<string, string> = {
  "ך": "כ", // ך -> כ
  "ם": "מ", // ם -> מ
  "ן": "נ", // ן -> נ
  "ף": "פ", // ף -> פ
  "ץ": "צ", // ץ -> צ
};

export function foldForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "") // niqqud and cantillation
    .replace(/[ךםןףץ]/g, (c) => FINALS[c] ?? c)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Terms that denote the SAME role. Order within a group does not matter.
 *
 * Kept to genuine equivalences: "developer" and "מפתח" are the same word in two
 * languages, whereas "developer" and "architect" are different jobs and belong
 * in RELATED below.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // Core engineering roles
  ["developer", "dev", "מפתח", "מפתחת", "מתכנת", "מתכנתת"],
  ["engineer", "מהנדס", "מהנדסת"],
  ["software engineer", "software developer", "מהנדס תוכנה", "מפתח תוכנה"],
  ["backend", "back end", "back-end", "בקאנד", "בק אנד", "צד שרת"],
  ["frontend", "front end", "front-end", "פרונטאנד", "פרונט אנד", "צד לקוח"],
  ["fullstack", "full stack", "full-stack", "פולסטאק", "פול סטאק"],
  ["mobile", "מובייל"],
  ["embedded", "אמבדד", "מוטמע"],
  ["hardware", "חומרה"],
  ["algorithms", "algorithm", "אלגוריתמים"],

  // Data / AI
  ["data", "דאטה", "נתונים"],
  ["data engineer", "מהנדס דאטה", "מהנדס נתונים"],
  // "analyst" is deliberately NOT in here. It was, and it meant a search for
  // "data analyst" also matched every marketing, business and financial analyst
  // in the index, because the group OR-ed the broad word back in.
  ["data analyst", "אנליסט נתונים", "אנליסט דאטה", "מנתח נתונים"],
  ["analyst", "אנליסט", "אנליסטית"],
  ["data scientist", "דאטה סיינטיסט", "מדען נתונים"],
  ["machine learning", "ml", "למידת מכונה"],
  ["ai", "artificial intelligence", "בינה מלאכותית"],

  // Infrastructure
  ["devops", "דבאופס"],
  ["sre", "site reliability"],
  ["infrastructure", "תשתיות"],
  ["cloud", "ענן"],
  ["security", "cyber", "cybersecurity", "אבטחה", "סייבר", "אבטחת מידע"],
  ["it support", "helpdesk", "תמיכה טכנית", "מוקד תמיכה"],
  ["support", "תמיכה"],

  // Quality
  ["qa", "quality assurance", "בדיקות", "בדיקות תוכנה"],
  ["automation", "אוטומציה"],

  // Product / design
  ["product", "מוצר"],
  ["product manager", "pm", "מנהל מוצר", "מנהלת מוצר"],
  ["design", "designer", "עיצוב", "מעצב", "מעצבת"],
  ["ux", "ui", "ux/ui", "חווית משתמש"],

  // Go-to-market
  ["marketing", "מרקטינג", "שיווק"],
  ["sales", "מכירות", "איש מכירות"],
  ["business development", "bizdev", "bd", "פיתוח עסקי"],
  ["customer success", "csm", "הצלחת לקוחות"],
  ["customer support", "שירות לקוחות"],

  // Business functions
  ["finance", "כספים", "פיננסים"],
  ["accountant", "accounting", "חשב", "חשבונאות", "הנהלת חשבונות"],
  // Split for the same reason: a recruiter is an HR role, but searching
  // "recruiter" was returning "HR economist, salary and benefits" because the
  // group pulled in the whole department.
  ["hr", "human resources", "משאבי אנוש"],
  ["recruiter", "technical recruiter", "talent acquisition", "sourcer", "מגייס", "מגייסת", "גיוס"],
  ["operations", "ops", "תפעול"],
  ["legal", "lawyer", "משפטי", "עורך דין"],
  ["project manager", "ניהול פרויקטים", "מנהל פרויקטים"],
  ["technical writer", "technical writing", "כתיבה טכנית"],

  // Seniority
  ["junior", "ג'וניור", "ג׳וניור", "זוטר"],
  ["senior", "סניור", "בכיר"],
  ["team lead", "team leader", "tech lead", "ראש צוות", "מוביל טכני", "מוביל צוות"],
  ["manager", "מנהל", "מנהלת"],
  ["director", "דירקטור"],
  ["student", "intern", "internship", "סטודנט", "סטודנטית", "התמחות", "מתמחה"],

  // Work setup
  ["remote", "work from home", "מהבית", "עבודה מרחוק", "מרחוק"],
  ["hybrid", "היברידי"],
  ["onsite", "on-site", "מהמשרד"],
  ["part time", "part-time", "משרה חלקית"],
  ["full time", "full-time", "משרה מלאה"],
  ["freelance", "contractor", "פרילנס", "עצמאי"],

  /*
   * Whole role titles.
   *
   * These exist because a multi-word query now expands ONLY on an exact match
   * (see lookup below). Without them "מנהל שיווק" would find nothing in
   * English, and with the old substring fallback it would instead have matched
   * every marketing job in the index. A phrase worth translating is worth
   * writing down.
   */
  ["system engineer", "systems engineer", "מהנדס מערכת", "מהנדס מערכות"],
  ["marketing manager", "מנהל שיווק", "מנהלת שיווק"],
  ["sales manager", "מנהל מכירות", "מנהלת מכירות"],
  ["product owner", "בעל מוצר"],
  ["backend developer", "backend engineer", "מפתח בקאנד", "מפתח צד שרת"],
  ["frontend developer", "frontend engineer", "מפתח פרונטאנד", "מפתח צד לקוח"],
  ["fullstack developer", "full stack developer", "מפתח פולסטאק"],
  ["mobile developer", "מפתח מובייל"],
  ["qa engineer", "מהנדס בדיקות", "בודק תוכנה", "בודקת תוכנה"],
  ["automation engineer", "מהנדס אוטומציה"],
  ["devops engineer", "מהנדס devops", "מהנדס תשתיות"],
  ["security engineer", "מהנדס אבטחה", "מהנדס סייבר"],
  ["support engineer", "מהנדס תמיכה", "איש תמיכה"],
  ["business analyst", "אנליסט עסקי"],
  ["account manager", "מנהל לקוחות", "מנהל תיקי לקוחות"],
  ["customer success manager", "מנהל הצלחת לקוחות"],
  ["hr manager", "מנהל משאבי אנוש", "מנהלת משאבי אנוש"],
  ["finance manager", "מנהל כספים", "מנהלת כספים"],
  ["operations manager", "מנהל תפעול", "מנהלת תפעול"],
];

/**
 * Neighbouring terms in the same field. Used ONLY for the near-match block.
 *
 * These are roles a seeker might also want but which are not the same job, so
 * mixing them into exact results would misrepresent what was found.
 */
export const RELATED_GROUPS: readonly (readonly string[])[] = [
  ["marketing", "שיווק", "growth", "seo", "ppc", "content", "campaign", "brand", "digital", "קמפיין", "תוכן", "מותג"],
  ["sales", "מכירות", "account executive", "sdr", "bdr", "business development", "פיתוח עסקי"],
  ["product", "מוצר", "product manager", "product owner", "ux", "ui", "analyst"],
  ["design", "עיצוב", "ux", "ui", "graphic", "brand", "product designer", "גרפי"],
  ["backend", "בקאנד", "api", "microservices", "node", "python", "java", "go", "server"],
  ["frontend", "פרונטאנד", "react", "vue", "angular", "typescript", "javascript", "css"],
  ["data", "דאטה", "analyst", "bi", "sql", "etl", "warehouse", "analytics", "אנליסט"],
  ["devops", "דבאופס", "sre", "kubernetes", "terraform", "aws", "cloud", "infrastructure", "תשתיות"],
  ["security", "סייבר", "cyber", "soc", "pentest", "appsec", "incident response", "אבטחת מידע"],
  ["qa", "בדיקות", "automation", "selenium", "cypress", "testing", "אוטומציה"],
  ["ai", "בינה מלאכותית", "machine learning", "ml", "llm", "nlp", "deep learning", "data scientist"],
  ["hr", "משאבי אנוש", "recruiter", "talent", "sourcer", "גיוס", "מגייס"],
  ["support", "תמיכה", "it", "helpdesk", "customer success", "service desk"],
  ["finance", "כספים", "accountant", "controller", "fp&a", "חשב", "בקר"],
];

function buildIndex(groups: readonly (readonly string[])[]) {
  const index = new Map<string, Set<string>>();
  for (const group of groups) {
    const folded = group.map(foldForSearch);
    for (const term of folded) {
      const bucket = index.get(term) ?? new Set<string>();
      for (const other of folded) bucket.add(other);
      index.set(term, bucket);
    }
  }
  return index;
}

const EXACT_INDEX = buildIndex(SYNONYM_GROUPS);
const RELATED_INDEX = buildIndex(RELATED_GROUPS);

/** Longest group terms first, so "product manager" wins over "product". */
const EXACT_TERMS = [...EXACT_INDEX.keys()].sort((a, b) => b.length - a.length);
const RELATED_TERMS = [...RELATED_INDEX.keys()].sort((a, b) => b.length - a.length);

function lookup(
  query: string,
  index: Map<string, Set<string>>,
  terms: string[],
  limit: number,
): string[] {
  const q = foldForSearch(query);
  if (!q) return [];

  const out = new Set<string>();

  // Whole-query match first: "product manager" should not be treated as
  // "product" + "manager", which would drag in every manager in the index.
  const whole = index.get(q);
  if (whole) for (const t of whole) out.add(t);

  /*
   * A MULTI-WORD query expands only on a whole-query match. Nothing else.
   *
   * The substring fallback below used to run for phrases too, and it was
   * actively destructive: "system engineer" found the known term "engineer"
   * inside it and produced
   *
   *     "system engineer" or engineer or מהנדס or מהנדסת
   *
   * which matches every job containing the word "engineer" — 1,477 of them,
   * against a few dozen real systems-engineering roles. OR-ing a component word
   * back into a phrase search throws away the very thing that made the phrase
   * specific. A phrase that deserves translation gets its own entry in
   * SYNONYM_GROUPS instead, where the whole-query lookup finds it.
   */
  if (!out.size && !q.includes(" ")) {
    // Single word: match the longest known term it contains. Safe here, because
    // there is no phrase precision left to lose.
    for (const term of terms) {
      if (term.length < 2) continue;
      if (q === term || q.includes(term)) {
        for (const t of index.get(term) ?? []) out.add(t);
        if (out.size >= limit) break;
      }
    }
  }

  out.delete(q); // the original is added by the caller
  return [...out].slice(0, limit);
}

/**
 * Terms meaning the same thing as `query`, excluding the query itself.
 * Empty when the query is not a known role word.
 */
export function expandQuery(query: string, limit = 10): string[] {
  return lookup(query, EXACT_INDEX, EXACT_TERMS, limit);
}

/** Neighbouring terms for the near-match block. */
export function relatedTerms(query: string, limit = 12): string[] {
  const exact = new Set([foldForSearch(query), ...expandQuery(query, 20)]);
  return lookup(query, RELATED_INDEX, RELATED_TERMS, limit + exact.size)
    .filter((t) => !exact.has(t))
    .slice(0, limit);
}

/**
 * Build a websearch-syntax query string.
 *
 * `websearch_to_tsquery` treats `or` as a disjunction and double quotes as a
 * phrase, so "marketing or \"מנהל שיווק\"" becomes 'marketing' | 'מנהל <-> שיווק'.
 * Multi-word terms are quoted; single words are not, because quoting a single
 * word is redundant and makes the generated query harder to read in logs.
 */
export function toWebsearchQuery(query: string, extras: string[]): string {
  const quote = (t: string) => (t.includes(" ") ? `"${t}"` : t);
  const base = query.trim();
  if (!extras.length) return base;
  return [quote(base), ...extras.map(quote)].join(" or ");
}

/* ------------------------------------------------------------------------- */
/* Hebrew gender and number forms                                             */
/* ------------------------------------------------------------------------- */

/**
 * The same Hebrew role word, written the other ways people write it.
 *
 * Hebrew inflects the job title itself. One role is spelled four ways before
 * anybody has typed a synonym:
 *
 *     מפתח    a developer (m)
 *     מפתחת   a developer (f)
 *     מפתחים  developers (m)
 *     מפתחות  developers (f)
 *
 * A woman searching for מפתחת found nothing, because the index stores what the
 * employer wrote and most employers write מפתח. `collapseGenderForms` already
 * handles the WRITTEN-OUT variants — מפתח/ת, מפתח(ת) — but not a plain
 * feminine word, and it cannot: stripping a trailing ת from arbitrary text
 * would maul ordinary words.
 *
 * Going the other way is safe. This ADDS suffixes to a known stem rather than
 * removing them from unknown text, so the worst case is a variant that matches
 * nothing.
 *
 * ## Why the stem must be at least three letters
 *
 * Two-letter Hebrew words are prepositions and particles. Generating suffixed
 * forms of those would produce common words and match everything.
 */
const HE_SUFFIXES = ["ת", "ית", "ות", "יות", "ים", "אית"] as const;

/** One leading clitic, so a query typed as `למפתח` still reaches `מפתח`. */
const HE_LEADING_CLITIC = /^[בלמוהשכ](?=[א-ת]{3,})/;

const variantCache = new Map<string, readonly string[]>();

export function hebrewVariants(token: string): readonly string[] {
  const cached = variantCache.get(token);
  if (cached) return cached;

  const out: string[] = [];
  const add = (t: string) => {
    if (t && t !== token && !out.includes(t)) out.push(t);
  };

  const bare = foldForSearch(token);
  if (/^[א-ת]{3,}$/.test(bare)) {
    // Suffixed forms of the word as given.
    for (const s of HE_SUFFIXES) add(bare + s);

    /*
     * And the stem with a suffix already on it, suffixed differently — so
     * מפתחת reaches מפתח and מפתחים, not only the other way round. Only when
     * what remains is still a real-length stem.
     */
    for (const s of HE_SUFFIXES) {
      if (bare.endsWith(s) && bare.length - s.length >= 3) {
        const stem = bare.slice(0, bare.length - s.length);
        add(stem);
        for (const s2 of HE_SUFFIXES) add(stem + s2);
      }
    }

    const declitic = bare.replace(HE_LEADING_CLITIC, "");
    if (declitic !== bare) add(declitic);
  }

  const frozen = Object.freeze(out);
  variantCache.set(token, frozen);
  return frozen;
}

/**
 * Hebrew variants for a SINGLE-TOKEN query only.
 *
 * A multi-word query is a phrase, and inflecting one word of it produces
 * combinations nobody wrote. `collapseGenderForms` runs first so an explicitly
 * written מפתח/ת has already become מפתח by the time this sees it.
 */
export function queryHebrewVariants(query: string, limit = 8): string[] {
  const q = collapseGenderForms(query).trim();
  if (!q || /\s/.test(q)) return [];
  return hebrewVariants(q).slice(0, limit);
}
