/**
 * Sanitization for third-party content.
 *
 * Job descriptions arrive as HTML from employer ATS feeds. We do not control
 * that HTML, so it is sanitized on the render path every time — not once at
 * ingest — so a bad row can never become stored XSS.
 *
 * This delegates to `sanitize-html` rather than a hand-rolled tokenizer:
 * HTML sanitization has too many edge cases (mutation XSS, namespace
 * confusion, malformed-markup parser divergence) to re-implement safely.
 */

import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr",
    "b", "strong", "i", "em", "u", "s", "sub", "sup", "small",
    "ul", "ol", "li",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "pre", "code",
    "a", "span", "div",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  // javascript:, data: and vbscript: are all excluded by omission.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  // Drop these elements together with their contents rather than unwrapping.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "template"],
  disallowedTagsMode: "discard",
  transformTags: {
    // Every outbound link is untrusted: no tab-nabbing, no referrer, no SEO juice.
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        target: "_blank",
        rel: "noopener noreferrer nofollow ugc",
      },
    }),
  },
  exclusiveFilter: (frame) =>
    // Drop anchors left hrefless after scheme filtering.
    frame.tag === "a" && !frame.attribs.href,
};

export function sanitizeJobHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, OPTIONS);
}

/** Any real HTML element. Entity-only content ("A &amp; B") is still plain text. */
const HTML_TAG = /<\/?[a-z][\s\S]*?>/i;

export type JobBody =
  | { kind: "html"; value: string }
  | { kind: "plain"; value: string }
  | { kind: "empty" };

/**
 * Decide how a job description should be rendered.
 *
 * ATS feeds send real markup. Social sources — Facebook groups, and LinkedIn
 * posts on the same path — send PLAIN TEXT whose paragraph structure is carried
 * entirely by newlines, and it lands in the same `description_html` column.
 * Rendering that as markup collapses every newline into a space, which is why
 * those posts appeared as one unbroken wall with the blank lines the author
 * actually typed silently removed.
 *
 * Sniffing for a tag is reliable here because the two producers are cleanly
 * separated: an ATS body always contains at least a <p> or <br>, and a social
 * post never contains markup (the scraper takes `.text()`, not `.html()`).
 *
 * The "plain" branch is returned for rendering as a React text node, so it is
 * escaped on the way out and never takes the raw-markup render path at all.
 * Only the "html" branch is sanitized markup.
 */
export function jobBody(
  html: string | null | undefined,
  text: string | null | undefined,
): JobBody {
  const raw = html?.trim();
  if (raw) {
    if (HTML_TAG.test(raw)) {
      const clean = sanitizeJobHtml(raw);
      if (clean.trim()) return { kind: "html", value: clean };
    }
    // Tagless: keep the newlines and let CSS honour them.
    return { kind: "plain", value: raw };
  }
  const plain = text?.trim();
  return plain ? { kind: "plain", value: plain } : { kind: "empty" };
}

/**
 * First N characters of a description, for the card excerpt.
 *
 * Works off the plain-text column when there is one and strips tags otherwise,
 * so an ATS body and a Facebook post produce the same shape of preview.
 */
export function excerptLines(
  html: string | null | undefined,
  text: string | null | undefined,
  maxChars = 180,
): string {
  const source =
    text?.trim() ||
    (html ? sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }) : "");
  const flat = source.replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;
  // Cut on a word boundary so the ellipsis never lands mid-word.
  const cut = flat.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/**
 * JSON-LD is injected into a script block, so the characters that could end
 * that block early, or that JSON allows raw but JavaScript treats as line
 * terminators, are escaped.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
