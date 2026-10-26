/**
 * Per-string text direction for employer content.
 *
 * The interface is English and LTR, but job titles and descriptions are written
 * by Israeli employers and are frequently Hebrew, frequently English, and
 * frequently both in one string ("מפתח Full Stack", "Senior Backend מהבית").
 *
 * Setting one direction for the whole page gets half of them wrong: an English
 * job title rendered RTL right-aligns and pushes its trailing punctuation to
 * the wrong end. So direction is decided per string, from the string itself.
 *
 * The rule is first-strong-with-a-threshold rather than plain first-strong:
 * a Hebrew description that happens to open with an English product name is
 * still a Hebrew paragraph and must read RTL.
 */

// Hebrew block, plus the Alphabetic Presentation Forms range for legacy text.
const HEBREW = /[֐-׿יִ-ﭏ]/g;
// Latin letters only; digits and punctuation are direction-neutral and excluded.
const LATIN = /[A-Za-z]/g;

export type Dir = "rtl" | "ltr";

function count(value: string, re: RegExp): number {
  const m = value.match(re);
  return m ? m.length : 0;
}

/**
 * Direction for a single string. Returns "ltr" for empty or neutral input,
 * which matches the document default and avoids a layout jump on null data.
 */
export function dirOf(value: string | null | undefined): Dir {
  if (!value) return "ltr";
  const he = count(value, HEBREW);
  if (he === 0) return "ltr";
  const la = count(value, LATIN);
  // Hebrew wins unless the Latin content clearly dominates. An Israeli job ad
  // with a few English stack names in it is still a Hebrew ad.
  return he * 2 >= la ? "rtl" : "ltr";
}

/** True when the string carries any Hebrew at all. */
export function hasHebrew(value: string | null | undefined): boolean {
  return Boolean(value) && HEBREW.test(String(value));
}

/**
 * Tailwind text-alignment class matching a direction.
 *
 * Job text sits inside an LTR page, so `text-start` would resolve against the
 * PAGE direction, not the element's. The alignment has to be explicit.
 */
export function alignOf(dir: Dir): string {
  return dir === "rtl" ? "text-right" : "text-left";
}

/** Convenience: both attributes for a block of employer text. */
export function textProps(value: string | null | undefined): {
  dir: Dir;
  className: string;
} {
  const dir = dirOf(value);
  return { dir, className: alignOf(dir) };
}
