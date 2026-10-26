/**
 * Recruiting / staffing agencies and the cues that give them away.
 * PLAN.md section 5.2 (`is_agency`).
 *
 * Agency postings are kept for dedupe but hidden from the main index
 * (PLAN.md 4.3 / 4.4), so a false positive costs us a real job — the name list
 * is deliberately conservative and the cues require agency-specific phrasing.
 */

/** Israeli staffing / placement firms, lowercase, matched on company name. */
export const AGENCY_NAMES: readonly string[] = [
  "manpower",
  "adecco",
  "randstad",
  "hays",
  "robert half",
  "michael page",
  "korn ferry",
  "heidrick",
  "egon zehnder",
  "ethosia",
  "אתוסיה",
  "nisha",
  "נישה",
  "jbh",
  "ג'וב הנטרס",
  "job hunters",
  "gotfriends",
  "גוט פרנדס",
  "reali",
  "ריאלי",
  "sqlink",
  "אס קיו לינק",
  "matrix",
  "מטריקס",
  "john bryce",
  "ג'ון ברייס",
  "malam team",
  "מלם תים",
  "aman",
  "אמן",
  "one1",
  "וואן1",
  "hilan",
  "חילן",
  "taldor",
  "טלדור",
  "ness",
  "נס טכנולוגיות",
  "experis",
  "אקספריס",
  "danel",
  "דנאל",
  "orian",
  "אוריין",
  "omni",
  "אומני",
  "prosource",
  "פרוסורס",
  "veo",
  "cyberpro",
  "hunters hr",
  "האנטרס",
  "talenteam",
  "טאלנטים",
  "top gun",
  "טופ גאן",
  "smart hunt",
  "career il",
  "קריירה",
  "human resources israel",
  "hr solutions",
  "פוטנציה",
  "potentia",
  "צוות 3000",
  "tzevet 3000",
  "כוח אדם",
  "אלמנטור השמה",
  "השמה",
  "recruitment agency",
  "staffing solutions",
  "talent solutions",
  "outsourcing",
  /*
   * Found by classifying 5,000 Israeli postings by employer: these four were
   * among the largest posters and none was caught, because the list matches on
   * name and none of their names contains a recruiting word. Jobgether is an
   * aggregator rather than a staffing firm, which amounts to the same thing
   * here — the posting is never its own vacancy.
   *
   * None of them had a job in the index when this was added, so nothing was
   * hidden retroactively. `abra` was the other large poster and is NOT here on
   * purpose: it is an IT services company that also hires in-house, it has 90
   * open jobs with us, and the list is documented above as conservative
   * because a false positive costs a real job. That one needs a human.
   */
  "comblack",
  "קומבלאק",
  "logica-it",
  "logica it",
  "jobgether",
  "korentec",
  "קורנטק",
];

/**
 * Phrases that only make sense when a third party is recruiting on behalf of an
 * unnamed client. "חברה מובילה" alone is weak, so it must co-occur with a
 * recruiting verb — see `looksLikeAgency`.
 */
export const AGENCY_STRONG_CUES: readonly string[] = [
  "לקוח שלנו",
  "ללקוח שלנו",
  "לקוחותינו",
  "our client",
  "for our client",
  "on behalf of our client",
  "חברת השמה",
  "חברת גיוס",
  "חברת כוח אדם",
  "recruitment agency",
  "staffing agency",
  "placement agency",
  "מגייסים עבור",
  "אנו מגייסים עבור",
  "confidential client",
  "client is looking for",
];

/** Weak cues — only count when paired with another weak cue or a name hit. */
export const AGENCY_WEAK_CUES: readonly string[] = [
  "חברה מובילה",
  "חברה גדולה",
  "חברת הייטק מובילה",
  "ארגון מוביל",
  "a leading company",
  "leading hi-tech company",
  "well known company",
  "מיקום: מרכז הארץ",
  "לחברה מצליחה",
  "לארגון גדול",
];
