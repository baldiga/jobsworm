/**
 * Hebrew / HTML normalization primitives.  PLAN.md section 5.3.
 *
 * `normalizeHe` MUST stay byte-for-byte equivalent to the SQL
 * `public.normalize_he(text)` in supabase/migrations/0008_functions.sql,
 * because `jobs.description_norm` and `jobs.title_norm` are written from TS
 * but re-derived and indexed on the database side.
 *
 * SQL reference implementation:
 *   btrim(regexp_replace(
 *     lower(translate(regexp_replace(txt, '[֑-ׇ]', '', 'g'),
 *                     'ךםןףץ', 'כמנפצ')),
 *     '\s+', ' ', 'g'))
 */

/** Niqqud + cantillation marks (U+0591..U+05C7). */
const NIQQUD_RE = /[֑-ׇ]/g;

/** Hebrew final letters and their non-final counterparts. */
const FINAL_LETTERS: Record<string, string> = {
  "ך": "כ", // ך -> כ
  "ם": "מ", // ם -> מ
  "ן": "נ", // ן -> נ
  "ף": "פ", // ף -> פ
  "ץ": "צ", // ץ -> צ
};
const FINAL_LETTERS_RE = /[ךםןףץ]/g;

/**
 * Strip niqqud, unify Hebrew final letters, lowercase, collapse whitespace.
 * Mirrors `normalize_he()` in SQL exactly (same order of operations).
 */
export function normalizeHe(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(NIQQUD_RE, "")
    .replace(FINAL_LETTERS_RE, (c) => FINAL_LETTERS[c] ?? c)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Feminine role nouns that appear as standalone words in Israeli job titles.
 * Collapsed to the masculine base so `title_norm` dedupes across genders.
 * Written non-final-form-first because collapseGenderForms runs *after*
 * final-letter unification when called from normalizeTitle().
 */
const FEMININE_FORMS: Array<[string, string]> = [
  ["מפתחת", "מפתח"], // מפתחת -> מפתח
  ["מתכנתת", "מתכנת"], // מתכנתת -> מתכנת
  ["מהנדסת", "מהנדס"], // מהנדסת -> מהנדס
  ["מנהלת", "מנהל"], // מנהלת -> מנהל
  ["בודקת", "בודק"], // בודקת -> בודק
  ["מעצבת", "מעצב"], // מעצבת -> מעצב
  ["אנליסטית", "אנליסט"], // אנליסטית -> אנליסט
  ["אדריכלית", "אדריכל"], // אדריכלית -> אדריכל
  ["טכנאית", "טכנאי"], // טכנאית -> טכנאי
  ["סטודנטית", "סטודנט"], // סטודנטית -> סטודנט
  ["חוקרת", "חוקר"], // חוקרת -> חוקר
  ["יועצת", "יועץ"], // יועצת -> יועץ
  ["ראשת", "ראש"], // ראשת -> ראש
  ["אחראית", "אחראי"], // אחראית -> אחראי
  ["מובילה", "מוביל"], // מובילה -> מוביל
  ["מתמחה", "מתמחה"], // מתמחה (epicene)
  ["מגייסת", "מגייס"], // מגייסת -> מגייס
  ["מרצה", "מרצה"], // מרצה (epicene)
];

const HEB = "א-ת";
/** JS \b does not work on Hebrew (Hebrew letters are not \w), so build our own. */
const heWord = (w: string) => new RegExp(`(?<![${HEB}])${w}(?![${HEB}])`, "g");

const FEMININE_RE: Array<[RegExp, string]> = FEMININE_FORMS.filter(
  ([f, m]) => f !== m,
).map(([f, m]) => [heWord(f), m]);

/**
 * Collapse Hebrew gender-inclusive job-title forms to the masculine base.
 *
 *   מפתח/ת        -> מפתח
 *   מפתחת         -> מפתח
 *   מהנדס/ת       -> מהנדס
 *   ראש/ת צוות    -> ראש צוות
 *   אנליסט/ית     -> אנליסט
 *   מעצב(ת)       -> מעצב
 *   דרוש/ה        -> דרוש
 *   מפתח(ים/ות)   -> מפתח
 *
 * Also collapses the English "(m/f)" / "(m/f/d)" / "(f/m/x)" decorations.
 */
export function collapseGenderForms(s: string | null | undefined): string {
  if (s == null) return "";
  let out = String(s);

  // English EEO decorations: (m/f), (m/f/d), (f/m/x), m/w/d
  out = out.replace(/\(\s*[mfdwx](?:\s*\/\s*[mfdwx]){1,2}\s*\)/gi, " ");
  out = out.replace(/(?<![a-z])[mf]\s*\/\s*[mf](?:\s*\/\s*[dx])?(?![a-z])/gi, " ");

  // Slash forms: base + "/" + a Hebrew feminine/plural suffix.
  //   ת ית ות ים ה יה אית
  out = out.replace(
    new RegExp(
      `([${HEB}]{2,})\\s*\\/\\s*(?:אית|יות|ית|ות|ים|יה|ת|ה)(?![${HEB}])`,
      "g",
    ),
    "$1",
  );

  // Parenthesised forms: מעצב(ת) / מפתח(ים) / מהנדס(ת)
  out = out.replace(
    new RegExp(
      `([${HEB}]{2,})\\s*\\(\\s*(?:אית|יות|ית|ות|ים|יה|ת|ה)\\s*\\)`,
      "g",
    ),
    "$1",
  );

  // Standalone feminine nouns.
  for (const [re, masc] of FEMININE_RE) {
    re.lastIndex = 0;
    out = out.replace(re, masc);
  }

  return out.replace(/\s+/g, " ").trim();
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  laquo: "«",
  raquo: "»",
  eacute: "é",
  shy: "",
  zwnj: "",
  lrm: "",
  rlm: "",
};

/** Decode the HTML entities that actually show up in ATS feed payloads. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => {
      const v = HTML_ENTITIES[name.toLowerCase()];
      return v === undefined ? m : v;
    });
}

const BLOCK_TAGS =
  "p|div|br|li|ul|ol|tr|td|th|table|h[1-6]|section|article|header|footer|blockquote|pre|hr";

/**
 * HTML -> readable plain text, preserving line structure so that
 * `splitSections()` in decompose.ts can still see headings and bullets.
 */
export function stripHtml(html: string | null | undefined): string {
  if (html == null) return "";
  let s = String(html);

  // Feeds (Greenhouse) hand us entity-escaped markup: unescape once so the
  // tags below are real tags, then decode the text entities at the end.
  if (/&lt;(?:p|div|br|ul|li|h[1-6]|strong|span)\b/i.test(s)) {
    s = decodeEntities(s);
  }

  s = s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // list bullets become "- " so requirement lines survive as lines
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(new RegExp(`<\\s*/?\\s*(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
    .replace(/<[^>]+>/g, "");

  s = decodeEntities(s);

  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ​]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fraction of Hebrew letters among all letters. 0 when there are no letters. */
export function hebrewRatio(s: string): number {
  const he = (s.match(/[א-ת]/g) ?? []).length;
  const latin = (s.match(/[A-Za-z]/g) ?? []).length;
  const total = he + latin;
  return total === 0 ? 0 : he / total;
}

/** PLAN.md 5.1 `lang`: he | en | mixed. */
export function detectLang(s: string): "he" | "en" | "mixed" {
  const r = hebrewRatio(s);
  if (r >= 0.6) return "he";
  if (r <= 0.12) return "en";
  return "mixed";
}
