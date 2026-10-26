/**
 * Hebrew PDFs that come out backwards.
 *
 * ## What goes wrong
 *
 * A PDF stores glyphs with positions, not a sentence. Many generators — older
 * Word exports, several CV builders, anything that laid the text out itself —
 * write Hebrew in VISUAL order: the characters appear in the file in the order
 * they are painted across the page, which for a right-to-left script is the
 * reverse of the logical order. The viewer looks right because the viewer is
 * placing glyphs; the extracted text is backwards.
 *
 * So `מפתחת תוכנה` arrives as `הנכות תחתפמ`, and every dictionary lookup, every
 * date, every title match fails. The CV parses to nothing and the person is
 * told we recognised no skills — for a document that is perfectly legible on
 * their screen. That is the worst failure this parser has: it is confident,
 * silent, and looks like the user's fault.
 *
 * ## Detecting it without a dictionary
 *
 * Hebrew has five FINAL letters — ך ם ן ף ץ — which may only appear at the end
 * of a word. That is an absolute orthographic rule, which makes it a free
 * signal: in correctly-ordered text a final letter is always word-final, and in
 * reversed text it is always word-INITIAL. No word list, no language model,
 * and it works on one word.
 *
 * A second signal backs it up: a handful of extremely common Hebrew words
 * spelled backwards. Either alone could misfire on a short line; together they
 * are decisive on a document.
 *
 * ## Repairing it
 *
 * Reverse the code points of the line, then re-reverse each Latin or digit run
 * inside it — those were laid out left-to-right already, so reversing the whole
 * line breaks them and reversing them back restores them. Brackets and quotes
 * are mirrored, because a `(` painted at the right end of an RTL line is
 * logically a `)`.
 *
 * ## Why it is decided per DOCUMENT, not per line
 *
 * A single line can look reversed by accident — an acronym, a filename, a
 * string of finals. Repairing a correctly-ordered line would destroy it. So
 * the decision is made over the whole document, and the repair is applied only
 * when a clear majority of Hebrew lines agree.
 */

const HE = "א-ת";
const HE_RE = new RegExp(`[${HE}]`);
const FINALS = "ךםןףץ";

/** Common Hebrew words, written backwards. Cheap corroboration. */
const REVERSED_WORDS = [
  "לש", // של
  "םע", // עם
  "לע", // על
  "ןויסינ", // ניסיון
  "הרבח", // חברה
  "תודובע", // עבודות
  "רואית", // תיאור
  "הלכשה", // השכלה
  "םירושיכ", // כישורים
  "ןויסנ", // נסיון
];

const MIRROR: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
};

/**
 * Whether one line's Hebrew reads backwards.
 *
 * Returns false for a line with no Hebrew, and for a line with too little to
 * judge — an opinion formed on two characters is not worth having.
 */
export function looksReversedHebrew(line: string): boolean {
  if (!HE_RE.test(line)) return false;

  let initialFinals = 0;
  let finalFinals = 0;

  for (const word of line.split(/[^א-ת]+/)) {
    if (word.length < 2) continue;
    if (FINALS.includes(word[0]!)) initialFinals++;
    if (FINALS.includes(word[word.length - 1]!)) finalFinals++;
  }

  if (initialFinals + finalFinals === 0) {
    // No evidence from finals; fall back to the word list alone.
    return REVERSED_WORDS.some((w) => line.includes(w));
  }

  // A final letter at the START of a word cannot happen in correct Hebrew.
  if (initialFinals > finalFinals) return true;
  if (finalFinals > initialFinals) return false;
  return REVERSED_WORDS.some((w) => line.includes(w));
}

/**
 * Whether the document as a whole is in visual order.
 *
 * A clear majority, not a bare one: repairing a correctly-ordered document
 * would destroy it, so the bar for acting is deliberately higher than the bar
 * for suspecting. Needs at least three Hebrew lines to have an opinion at all.
 */
export function documentIsVisual(text: string, threshold = 0.6): boolean {
  const lines = text.split(/\r?\n/).filter((l) => HE_RE.test(l) && l.trim().length > 3);
  if (lines.length < 3) return false;
  const reversed = lines.filter(looksReversedHebrew).length;
  return reversed / lines.length >= threshold;
}

const reverse = (s: string) => [...s].reverse().join("");

/**
 * Put one visual-order line back into logical order.
 *
 * Latin and digit runs are re-reversed because they were never reversed in the
 * first place — they are laid out left-to-right inside an RTL line, so the
 * whole-line reversal is what broke them.
 */
export function repairVisualLine(line: string): string {
  const flipped = reverse(line);
  // Runs of Latin letters, digits and the punctuation that binds them
  // (versions, emails, dates) are restored to their own direction.
  return flipped
    .replace(/[A-Za-z0-9][A-Za-z0-9.@+#_/\\-]*/g, (run) => reverse(run))
    .replace(/[()[\]{}<>]/g, (c) => MIRROR[c] ?? c);
}

/**
 * Repair a whole document if, and only if, it is in visual order.
 *
 * Returns the text unchanged otherwise — including for a document with no
 * Hebrew in it at all, which is the common case and must cost nothing.
 */
export function repairVisualText(text: string): { text: string; repaired: boolean } {
  if (!documentIsVisual(text)) return { text, repaired: false };
  const out = text
    .split(/\r?\n/)
    // Only the Hebrew lines. A line of pure English inside a Hebrew CV — an
    // email address, a stack list — was never reversed and must not be touched.
    .map((line) => (HE_RE.test(line) ? repairVisualLine(line) : line))
    .join("\n");
  return { text: out, repaired: true };
}

/** Turn logical-order text into visual order. For tests only. */
export function toVisual(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (HE_RE.test(line) ? repairVisualLine(line) : line))
    .join("\n");
}
