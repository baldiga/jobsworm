/**
 * Text hygiene for anything scraped before it reaches Postgres.
 *
 * Two characters break the write, and both turn up in social posts:
 *
 * - U+0000. Postgres rejects it in `text` and `json` outright. It arrives via
 *   copy-paste out of PDFs and some editors.
 * - Lone surrogates. An emoji whose pair is split by a length cap leaves half
 *   a code point behind, which is not valid UTF-8 and fails JSON encoding.
 *
 * One bad post failed an entire 2,000-row import with "invalid input syntax
 * for type json" and named no row, so this runs over every free-text field
 * rather than being applied where a problem was last seen.
 */

const NULL_BYTE = /\u0000/g;
// A high surrogate not followed by a low one.
const LONE_HIGH = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g;
// A low surrogate not preceded by a high one.
const LONE_LOW = /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function scrub(value: string): string {
  return value.replace(NULL_BYTE, "").replace(LONE_HIGH, "").replace(LONE_LOW, "$1");
}

/** Convenience for optional fields; empty becomes null so columns stay clean. */
export function scrubOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const out = scrub(value);
  return out.length ? out : null;
}
