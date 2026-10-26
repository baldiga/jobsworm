/**
 * Consent A — shown at signup (PLAN.md section 8, section 12).
 *
 * Israel's Privacy Protection Law Amendment 13 requires notice at collection
 * covering: what is mandatory versus voluntary, the purpose, the controller's
 * identity, transfers to third parties, the consequences of refusing, and the
 * rights of access and correction.
 *
 * The exact text is versioned and hashed at signup so we can prove later what
 * a given user actually agreed to. Never edit CONSENT_A_TEXT in place — add a
 * new version, because the hash of the old text must keep resolving.
 *
 * Running your own deployment? The operator and address below are the
 * original site's. Write your own text under a new CONSENT_A_VERSION; the law
 * this follows requires the notice to name whoever actually holds the data.
 */

export const CONSENT_A_VERSION = "A-2026-09-07";

export const CONSENT_A_TEXT_HE = `
Jobsworm (מפעיל: אמיר בלדיגה, privacy@jobswarm.com) אוסף את כתובת המייל שלך, החיפושים
השמורים והמשרות שסימנת, וקורות חיים אם תעלה אותם. המידע משמש לחיפוש, להתאמות ולהתראות
בלבד. מסירת המידע היא מרצון — אפשר לגלוש ולחפש בלי חשבון, ואי-מסירה לא פוגעת בשימוש
באתר. המידע נשמר אצל ספקי התשתית שלנו: Vercel ו-Supabase. אפשר לעיין במידע, לתקן אותו
או למחוק את החשבון כולו בלחיצה אחת בעמוד "האזור שלי". חשבון לא פעיל 12 חודשים נמחק,
וקורות חיים מפסיקים לשמש להתאמות אחרי 90 יום. אנחנו לא אוספים גיל, מגדר, מצב משפחתי,
בריאות, דת, יחידה צבאית או מספר זהות, ולא מוכרים מידע לאף אחד.
`.trim();

export const CONSENT_A_TEXT_EN = `
Jobsworm (operator: Amir Baldiga, privacy@jobswarm.com) collects your email address, your
saved searches and saved jobs, and your CV if you upload one. This is used for search,
matching and alerts only. Providing it is voluntary: browsing and searching work without an
account, and refusing costs you nothing. Data is processed by our infrastructure providers,
Vercel and Supabase. You can view your data, correct it, or delete your whole account in one
click from "My area". Accounts inactive for 12 months are deleted, and a CV stops being used
for matching after 90 days. We never collect age, gender, family status, health, religion,
military unit or ID number, and we never sell data.
`.trim();

/**
 * Stable hash of the exact text shown, stored alongside the consent record.
 * SHA-256 via Web Crypto so the same code runs on the server and in the browser.
 */
export async function consentTextHash(): Promise<string> {
  const payload = `${CONSENT_A_VERSION}\n${CONSENT_A_TEXT_HE}\n${CONSENT_A_TEXT_EN}`;
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
