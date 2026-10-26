/**
 * Trusting a general jobs board's own category, because our classifier cannot
 * read it.
 *
 * `drushimavodot` publishes ~7,900 jobs across all of Israel: restaurants,
 * nursing, driving, security guards, retail, and about 4% hi-tech. Running the
 * usual title-and-body classifier over it produced 1,975 "tech" jobs, and the
 * sample was nonsense — a bookkeeping clerk read as solutions engineering, a
 * medical secretary as software engineering, a nurse as QA. The classifier was
 * built for boards whose crawl is already restricted to hi-tech categories,
 * where the question is WHICH tech role rather than WHETHER it is one, and it
 * has no way to answer the second question from Hebrew free text alone.
 *
 * The feed answers it for us. Every row carries the publisher's own `category`,
 * and a category is a fact stated by the person who posted the job rather than
 * a guess made from their prose. So the category runs first, as a gate, and the
 * classifier only ever sees rows that are already known to be tech.
 *
 * The list below is deliberately tight. Two categories that arguably belong
 * were left out on purpose:
 *
 *   הנדסה (197 jobs)   civil and mechanical. The sample was the Purple Line,
 *                      metro tenders and structural work, not R&D.
 *   בקרת איכות (23)    factory quality control, not software QA.
 *
 * Being conservative here costs us a handful of real jobs. Being generous costs
 * every search on the site its credibility, which is the more expensive
 * mistake, and it is the one already reported by users.
 */

/**
 * Matched anywhere in the category. Each one is unambiguous on its own: no
 * Hebrew category containing "אבטחת מידע" is about anything but security.
 */
const TECH_CATEGORY_CONTAINS = [
  "הייטק",
  "פיתוח תוכנה",
  "פיתוח מוצרים",
  "מערכות מידע",
  "אבטחת מידע",
  "תמיכה טכנית",
  "טכנולוגי", // covers טכנולוגיה and טכנולוגיות
  "ניהול מוצר",
  "סייבר",
  "cyber",
  "software",
  "data analysis",
  "data & analytics",
  "data and analytics",
  "devops",
];

/**
 * Matched as the WHOLE category, never as a substring.
 *
 * "it" is the reason this second list exists: as a substring it matches
 * "Recruitment", "Hospitality", "Security" and most other English words on the
 * board, which would let the entire feed through a gate meant to keep it out.
 */
const TECH_CATEGORY_EXACT = new Set([
  "it",
  "qa",
  "it & software",
  "it and cyber security",
  "אלקטרוניקה",
  "חשמל ואלקטרוניקה",
  "ניהול טכני",
]);

/** True when a general board's own category says this row is a tech job. */
export function isTechCategory(category: string | null | undefined): boolean {
  const c = String(category ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!c) return false; // 493 rows carry no category at all. Not our problem to guess.
  if (TECH_CATEGORY_EXACT.has(c)) return true;
  return TECH_CATEGORY_CONTAINS.some((t) => c.includes(t));
}

/**
 * Sources whose crawl is NOT restricted to tech, so the feed's own category has
 * to stand in for the restriction the crawl never applied.
 */
export const CATEGORY_GATED_SOURCES = new Set(["drushimavodot"]);
