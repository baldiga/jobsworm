/**
 * Boundary-aware text matching used by every dictionary lookup in
 * `decompose.ts` (cities, skills, function keywords, agency names).
 *
 * JavaScript's `\b` is defined over `[A-Za-z0-9_]`, so it fires *inside*
 * Hebrew words and never at their edges. Every helper here inspects the
 * neighbouring code points directly instead.
 */

/** A character that would make a match a substring of a longer word. */
const LETTERISH = /[A-Za-z0-9א-ת]/;

/**
 * Hebrew one-letter clitics (be / le / mi / ve / ha / she / ke). They glue
 * straight onto the following word, so `בתל אביב` must still match `תל אביב`.
 */
const HE_CLITICS = new Set(["ב", "ל", "מ", "ו", "ה", "ש", "כ"]);

/** Index of the first boundary-respecting occurrence of `term`, or -1. */
export function findTerm(haystack: string, term: string, from = 0): number {
  if (!term || !haystack) return -1;
  let idx = haystack.indexOf(term, from);
  while (idx >= 0) {
    const before = idx > 0 ? haystack[idx - 1]! : "";
    const after = haystack[idx + term.length] ?? "";
    const beforeOk =
      before === "" ||
      !LETTERISH.test(before) ||
      (HE_CLITICS.has(before) && (idx < 2 || !LETTERISH.test(haystack[idx - 2]!)));
    const afterOk = after === "" || !LETTERISH.test(after);
    if (beforeOk && afterOk) return idx;
    idx = haystack.indexOf(term, idx + 1);
  }
  return -1;
}

/** Word-boundary aware `includes` that understands Hebrew. */
export function containsTerm(haystack: string, term: string): boolean {
  return findTerm(haystack, term) >= 0;
}

/** The first term from `terms` that appears in `haystack`, or null. */
export function firstTerm(haystack: string, terms: readonly string[]): string | null {
  for (const t of terms) if (containsTerm(haystack, t)) return t;
  return null;
}

/** How many distinct terms from `terms` appear in `haystack`. */
export function countTerms(haystack: string, terms: readonly string[]): number {
  let n = 0;
  for (const t of terms) if (containsTerm(haystack, t)) n++;
  return n;
}

/** True when the string contains at least one Hebrew letter. */
export function hasHebrew(s: string): boolean {
  return /[א-ת]/.test(s);
}

/** True when the string contains at least one Latin letter. */
export function hasLatin(s: string): boolean {
  return /[A-Za-z]/.test(s);
}

/** Escape a literal for inclusion in a RegExp source. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove every occurrence of `term` (boundary-aware) from `s`. */
export function removeTerm(s: string, term: string): string {
  let out = s;
  for (;;) {
    const i = findTerm(out, term);
    if (i < 0) return out;
    out = `${out.slice(0, i)} ${out.slice(i + term.length)}`;
  }
}
