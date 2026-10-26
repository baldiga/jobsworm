/**
 * A Facebook post has no title field, so the role has to be recovered from the
 * opening line. Posts routinely open with a full sentence, and using that raw
 * gives a job card whose heading is a paragraph.
 *
 * Three passes, cheapest first: cut at the first line break and sentence
 * boundary, then at a natural Hebrew clause break, then on a word boundary.
 */

import { CITY_INDEX, FUNCTION_DEFS } from "@jobsworm/core";

const MAX_TITLE = 70;

/**
 * Every title keyword the function classifier knows, in one set.
 *
 * Used as a positive signal rather than as a filter: most real titles are not
 * in here ("משרת ג'וניור", "מעצב.ת גרפי.ת" — Hebrew gender-inclusive spelling
 * defeats substring matching), so requiring a hit would reject more good
 * titles than bad ones. It decides only the ambiguous single-word case.
 */
const ROLE_WORDS: string[] = FUNCTION_DEFS.flatMap((d) => d.title.map((t) => t.toLowerCase()));

function namesARole(line: string): boolean {
  const low = line.toLowerCase();
  return ROLE_WORDS.some((w) => low.includes(w));
}

/**
 * Hebrew job titles that the Latin-oriented gazetteer above cannot see.
 *
 * Two shapes carry almost all of them. The first is the gendered form, written
 * with a slash or a full stop — "מפתח/ת", "מעצב.ת", "מפעיל.ת" — which is
 * close to a grammatical marker for "this is a job title" and which defeats
 * substring matching against a dictionary. The second is the handful of nouns
 * that introduce a role outright.
 */
const HEBREW_TITLE_SHAPE = [
  /[֐-׿][\/.][הת](?:\s|$|[\/.])/u,
  /(?:^|\s)(?:משרת|תפקיד|מהנדס|מפתח|מנהל|רכז|אנליסט|בודק|מעצב|יועץ|טכנאי|ראש\s+צוות)/u,
];

/**
 * The noun a job title ends on.
 *
 * Needed because the gazetteer is a list of known roles and therefore has
 * holes — "DevSecOps Engineer" is not in it, and does not contain "devops" as
 * a substring either, so a real title was being thrown away. This is the
 * generic shape rather than another entry, and it is deliberately a short list
 * of nouns that name people who do jobs.
 */
const ENGLISH_TITLE_SHAPE =
  /\b(?:engineer|developer|programmer|manager|analyst|designer|architect|lead|specialist|researcher|scientist|intern|student|tester|consultant|administrator|officer|director|technician|coordinator|executive|associate|representative|strategist|devops|sre|qa)\b/i;

/**
 * Would a reader accept this line as the name of a job?
 *
 * This is the guard that had to become positive. Rejecting known-bad shapes —
 * cities, questions, section headings, employment types — leaks by
 * construction: the next post simply puts something else on its own line, and
 * "Sunday to Thursday" becomes a job title. Requiring a recognisable role
 * instead fails safe, because failing means keeping the generic label, which
 * is merely unhelpful rather than wrong.
 */
function looksLikeATitle(line: string): boolean {
  return (
    namesARole(line) ||
    ENGLISH_TITLE_SHAPE.test(line) ||
    HEBREW_TITLE_SHAPE.some((re) => re.test(line))
  );
}

/** "<role> אנחנו מחפשים ..." - the role is the part before the verb. */
const CLAUSE_BREAK =
  /\s(?:אנחנו|אנו|מחפשים|מחפשות|מגייסים|מגייסות|למשרה|לתפקיד|לחברה|לצוות|for our|we are|we're|looking for)\s/;

const LEADING_JUNK = /^[\s*#•\-–—:]+/;
const TRAILING_JUNK = /[\s*#•\-–—:]+$/;
const SENTENCE_BREAK = /[.!?·|]\s|\s[-–—]\s/;

/**
 * Posters bold their headline with markdown-style asterisks that Facebook does
 * not render, so "**דרוש/ה מפתח/ת SQL** **עבודה בחיפה**" arrives with the
 * asterisks intact and they show up on the job card.
 */
const EMPHASIS = /\*{1,3}/g;

/**
 * Decorative emoji and pictographs posters open a headline with.
 *
 * U+2300-U+23FF was missing and had to be added: it holds ⏰, ⌚ and ⏳, and a
 * post whose section heading read "⏰ Shifts" therefore kept its clock. That
 * mattered beyond the stray character — with the emoji attached the line
 * counted as two words and slipped past the single-word role check below.
 */
const LEADING_EMOJI =
  /^(?:[\u{1F300}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\s])+/u;

/**
 * An opening line that announces a vacancy without naming one.
 *
 * Reported as "ראיתי שיש משרה חדשה אבל אין כותרת, לא ברור מה זה" — a card
 * headed "משרה חדשה", which means "new job" and says nothing at all. It is not
 * a stray: one recruiter posts to a fixed template,
 *
 *     משרה חדשה
 *
 *     Game Developer
 *
 *     כל הפרטים וההגשה כאן:
 *     https://…
 *
 * so the first line is always the label and the role is always two lines down.
 * 45 open rows carried such a title when this was written, 40 of them from that
 * one template.
 *
 * Anchored at both ends: this matches only when the WHOLE line is the label, so
 * "משרה חדשה: Game Developer" and "דרוש/ה QA" are untouched — those name a role
 * and the existing passes handle them.
 */
const NAMES_NO_ROLE =
  /^(?:משרה\s*חדשה|משרה|משרות|דרוש(?:ה|ים|ות|\/ה|\/ות)?|מגייס(?:ים|ות|ת)?|הזדמנות(?:\s+תעסוקתית)?|הצעת\s+עבודה|new\s+job|job\s+(?:opening|alert|post)|we(?:'|’)?(?:re| are)\s+hiring|hiring|open\s+position)\s*$/i;

/**
 * Lines that follow the label but are not the role either.
 *
 * "אין צורך בניסיון קודם" ("no previous experience needed") sits between the
 * label and the role in that same template, and is a qualifier rather than a
 * job. Note this only rejects a line that is ENTIRELY the qualifier — "דרוש/ה
 * QA ללא ניסיון" is a real title and must survive.
 */
const NOT_A_ROLE = [
  /^(?:אין\s+צורך\s+ב|ללא\s+)(?:ניסיון|נסיון)(?:\s+קודם)?[!.]*$/,
  /^(?:כל\s+ה?פרטים|לפרטים|להגשה|פרטים\s+נוספים|למועמדות|הגשת\s+מועמדות)/,
  /^(?:full\s+details|apply|to\s+apply|more\s+info)/i,
  /^https?:\/\//i,
  /^[#@]\S+$/,
  // A question is never a job title. Catches the English "we're hiring"
  // graphic posts, whose body opens with ad copy: "אוהב/ת לקוחות גלובליים?",
  // "מה אנחנו מחפשים?".
  /\?\s*$/,
  // Section headings from the body of a long post: "תחום השכר", "על החברה".
  /^(?:תחום|מה\s|למה\s|אודות|על\s+החברה|about\s|why\s|what\s|who\s)/i,
  // A requirement, not a role: "3+ שנות ניסיון ביישום…".
  /^\d+\+?\s*(?:שנות|שנים|years)/i,
  // Ad copy: "זו יכולה להיות המשרה הבאה שלך!".
  /^(?:זו|זאת)\s+יכולה?\s+להיות/,
  /*
   * A duty rather than a role: "אחריות מלאה על תהליך השכר", "טיפול בשכר
   * מורכב ומגוון". `ניהול` is deliberately absent — "ניהול מוצר" is a real
   * title, and rejecting it would cost more than the occasional duty line.
   */
  /^(?:אחריות|טיפול|ביצוע|מתן|הובלת)\s/,
  // Anything that reads as a full sentence. Titles do not end in a full stop.
  /[.]\s*$/,
  /*
   * An employment type or a work setup, which these posts also put on their
   * own line. "Full time" is not a job title, and it sits close enough to the
   * city line that rejecting one without the other just moves the problem.
   */
  /^(?:full[\s-]?time|part[\s-]?time|freelance|contract|internship|hybrid|remote|on[\s-]?site|shifts?)$/i,
  /^(?:משרה\s+(?:מלאה|חלקית)|משמרות|היברידי|מרחוק|עבודה\s+מהבית)$/,
];

/** Trim, de-emphasise and de-junk one candidate line. */
function clean(line: string): string {
  return line
    .replace(EMPHASIS, " ")
    .replace(LEADING_EMOJI, "")
    .replace(LEADING_JUNK, "")
    .replace(TRAILING_JUNK, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The first line further down the post that could actually be a job title.
 *
 * Deliberately conservative. A candidate has to be short enough to be a title
 * in the first place, which is what keeps a company blurb out — "Limy is
 * building the infrastructure for brands to own their visibility in AI search"
 * is 83 characters and is passed over, leaving the generic label in place
 * rather than replacing it with something worse.
 */
function roleFromBody(text: string): string {
  const lines = text.split(/\r?\n/).slice(1);
  for (const raw of lines) {
    const line = clean(raw.split(SENTENCE_BREAK)[0] ?? "");
    if (line.length < 3 || line.length > MAX_TITLE) continue;
    if (NAMES_NO_ROLE.test(line)) continue;
    if (NOT_A_ROLE.some((re) => re.test(line))) continue;
    // A line that is only a place. These posts put the location on its own
    // line — "Tel Aviv" was being promoted to the job title. CITY_INDEX is the
    // same gazetteer decomposition resolves locations with, so this stays in
    // step with it for free.
    if (CITY_INDEX.has(line.toLowerCase())) continue;
    if (!looksLikeATitle(line)) continue;
    return line;
  }
  return "";
}

export function socialTitle(text: string): string {
  let t = clean((text.split(/\r?\n/)[0] ?? "").split(SENTENCE_BREAK)[0] ?? "");

  /*
   * "משרה חדשה" tells the reader nothing, and the role is usually a line or
   * two below it. Only replace when something better is actually found: a card
   * headed "משרה חדשה" is poor, but one headed with a sentence from the middle
   * of the post is worse.
   */
  if (NAMES_NO_ROLE.test(t)) {
    const role = roleFromBody(text);
    if (role) t = role;
  }

  if (t.length > MAX_TITLE) {
    const clause = t.split(CLAUSE_BREAK)[0];
    if (clause && clause.length >= 10) t = clause.trim();
  }

  if (t.length > MAX_TITLE) {
    const cut = t.slice(0, MAX_TITLE);
    const lastSpace = cut.lastIndexOf(" ");
    t = (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).replace(TRAILING_JUNK, "").trim();
  }

  return t;
}
