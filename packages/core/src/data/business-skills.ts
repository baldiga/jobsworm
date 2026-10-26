/**
 * Go-to-market and business skills — the other half of the vocabulary.
 *
 * `skills.ts` is a tech dictionary. That was fine while the index was only
 * engineering roles, but it meant a marketing or RevOps CV could only ever
 * match on whatever incidental tech words it happened to contain: someone who
 * runs lifecycle campaigns and mentions SQL and Python once came out looking
 * like a backend developer, because those were the only two terms the parser
 * could see.
 *
 * Same shape as `skills.ts` — `[canonical, ...aliases]`, lowercase, longest
 * alias wins — so both dictionaries feed one matcher and both sides of a match
 * agree on what a term is called.
 *
 * Hebrew aliases matter more here than in the tech dictionary. Israeli tech
 * job ads write "React" in English but "שיווק" and "מכירות" in Hebrew, so a
 * GTM term without its Hebrew form is invisible on roughly half the index.
 */

import type { SkillCategory } from "./skills";

export type BusinessCategory =
  | "crm"
  | "marketing_automation"
  | "sales_engagement"
  | "analytics"
  | "advertising"
  | "seo_content"
  | "revops"
  | "finance"
  | "people"
  | "pm_tools"
  | "design_tools"
  | "ecommerce";

type Row = readonly [string, ...string[]];

const GROUPS: readonly (readonly [BusinessCategory, readonly Row[]])[] = [
  ["crm", [
    ["salesforce", "sfdc", "sales force", "סיילספורס"],
    ["hubspot", "האבספוט"],
    ["pipedrive"],
    ["zoho"],
    ["microsoft dynamics", "dynamics 365"],
    ["monday.com", "monday crm"],
    ["crm", "ניהול קשרי לקוחות", "מערכת crm"],
  ]],

  ["marketing_automation", [
    ["marketo"],
    ["pardot"],
    ["braze"],
    ["iterable"],
    ["customer.io"],
    ["klaviyo"],
    ["activecampaign"],
    ["mailchimp", "מיילצ'ימפ"],
    ["marketing automation", "אוטומציה שיווקית"],
    /*
     * NO bare "lifecycle" alias. It matched "software development lifecycle",
     * "product lifecycle" and "asset lifecycle", so a Field CTO and a Chief
     * Development Officer at an energy company both carried "lifecycle
     * marketing" in their tech_stack — and therefore turned up in a search for
     * Marketing, which is how this was found.
     */
    ["lifecycle marketing", "lifecycle campaigns", "lifecycle marketing"],
    ["crm marketing"],
    ["email marketing", "שיווק במייל", "דיוור"],
    ["push notifications", "התראות פוש"],
  ]],

  ["sales_engagement", [
    ["outreach.io", "outreach"],
    ["salesloft"],
    ["gong.io", "gong"],
    ["chorus.ai"],
    ["apollo.io"],
    ["zoominfo"],
    ["clay.com"],
    ["lusha"],
    ["sales navigator", "linkedin sales navigator"],
    ["cold outreach", "cold email", "פנייה קרה"],
    ["lead generation", "lead gen", "יצירת לידים", "לידים"],
    ["prospecting"],
    ["bant"],
    ["meddic", "meddpicc"],
  ]],

  ["analytics", [
    ["google analytics", "ga4", "גוגל אנליטיקס"],
    ["google tag manager", "gtm tag manager"],
    ["mixpanel"],
    ["amplitude"],
    ["looker", "looker studio", "data studio"],
    ["tableau"],
    ["power bi", "powerbi"],
    ["hotjar"],
    ["segment.com"],
    ["ab testing", "a/b testing", "בדיקות a/b", "מבחני a/b"],
    ["attribution", "אטריביושן", "ייחוס"],
    ["cohort analysis"],
    ["dashboards", "דשבורדים"],
  ]],

  ["advertising", [
    ["google ads", "adwords", "גוגל אדס"],
    ["meta ads", "facebook ads", "פייסבוק אדס"],
    ["linkedin ads"],
    ["tiktok ads"],
    ["taboola"],
    ["outbrain"],
    ["criteo"],
    ["dv360", "display & video 360"],
    ["programmatic", "פרוגרמטיק"],
    ["ppc", "פיפיסי"],
    ["sem"],
    ["paid social"],
    ["paid media", "מדיה בתשלום"],
    ["media buying", "רכש מדיה"],
    ["performance marketing", "שיווק ביצועים"],
    ["user acquisition", "ua", "גיוס משתמשים"],
    ["roas"],
    ["cpa"],
    ["cpc"],
    ["cpm"],
  ]],

  ["seo_content", [
    ["seo", "קידום אתרים", "אס אי או"],
    ["ahrefs"],
    ["semrush"],
    ["moz"],
    ["screaming frog"],
    ["content marketing", "שיווק תוכן"],
    ["copywriting", "קופירייטינג", "כתיבה שיווקית"],
    ["content strategy", "אסטרטגיית תוכן"],
    ["technical seo"],
    ["link building"],
    ["keyword research", "מחקר מילות מפתח"],
    ["social media management", "ניהול רשתות חברתיות"],
    ["community management", "ניהול קהילה"],
    ["influencer marketing", "שיווק משפיענים"],
    ["brand", "מיתוג", "ניהול מותג"],
    ["pr", "יחסי ציבור"],
  ]],

  ["revops", [
    ["revops", "revenue operations", "תפעול הכנסות"],
    ["sales operations", "sales ops", "תפעול מכירות"],
    ["marketing operations", "marketing ops"],
    ["pipeline management", "ניהול פייפליין", "פייפליין"],
    ["forecasting", "תחזיות", "תחזית מכירות"],
    ["quota", "עמידה ביעדים"],
    ["territory planning"],
    ["lead scoring", "ניקוד לידים"],
    ["funnel", "משפך", "משפך שיווקי"],
    ["conversion rate optimization", "cro", "אופטימיזציית המרות"],
    ["mql"],
    ["sales qualified lead", "sql lead"],
    ["arr"],
    ["mrr"],
    ["churn", "נטישה"],
    ["cac"],
    ["ltv"],
    ["nrr"],
    ["go to market", "gtm strategy", "אסטרטגיית go to market"],
    ["account based marketing", "abm"],
    ["customer success", "הצלחת לקוחות"],
    ["onboarding", "הטמעה"],
    ["retention", "שימור לקוחות", "שימור"],
    ["upsell", "אפסייל"],
    ["cross sell"],
    ["renewals", "חידושים"],
  ]],

  ["finance", [
    ["netsuite"],
    ["sap"],
    ["priority erp", "פריוריטי"],
    ["quickbooks"],
    ["fp&a", "fpa"],
    ["financial modeling", "מודלים פיננסיים"],
    ["budgeting", "תקצוב", "ניהול תקציב"],
    ["p&l", "רווח והפסד"],
    ["invoicing", "חשבוניות"],
    ["bookkeeping", "הנהלת חשבונות"],
    ["excel", "אקסל"],
    ["google sheets", "גוגל שיטס"],
  ]],

  ["people", [
    ["hibob", "bob hr"],
    ["comeet"],
    ["workday hcm"],
    ["recruiting", "גיוס", "ריקרוטינג"],
    ["sourcing", "סורסינג"],
    ["employer branding", "מיתוג מעסיק"],
    ["onboarding hr", "קליטת עובדים"],
    ["performance reviews", "הערכות עובדים"],
    ["compensation", "תגמול"],
  ]],

  ["pm_tools", [
    ["jira", "ג'ירה"],
    ["asana"],
    ["notion", "נושן"],
    ["monday", "מאנדיי"],
    ["trello"],
    ["clickup"],
    ["confluence"],
    ["airtable"],
    ["zapier", "זאפייר"],
    ["make.com", "integromat"],
    ["project management", "ניהול פרויקטים"],
    ["stakeholder management", "ניהול מחזיקי עניין"],
    ["agile", "אג'ייל"],
    ["scrum", "סקראם"],
  ]],

  ["design_tools", [
    ["figma", "פיגמה"],
    ["adobe creative suite", "adobe creative cloud"],
    ["photoshop", "פוטושופ"],
    ["illustrator", "אילוסטרייטור"],
    ["after effects"],
    ["canva", "קנבה"],
    ["sketch app"],
    ["ux research", "מחקר משתמשים"],
    ["wireframes", "ווירפריימים"],
    ["prototyping", "פרוטוטייפ"],
  ]],

  ["ecommerce", [
    ["shopify", "שופיפיי"],
    ["woocommerce"],
    ["magento"],
    ["ecommerce", "e-commerce", "מסחר אלקטרוני", "איקומרס"],
    ["marketplace", "מרקטפלייס"],
    ["merchandising"],
  ]],
];

export interface BusinessSkillEntry {
  term: string;
  aliases: string[];
  category: BusinessCategory;
}

export const BUSINESS_SKILLS: BusinessSkillEntry[] = GROUPS.flatMap(([category, rows]) =>
  rows.map(([term, ...aliases]) => ({ term, aliases: [...aliases], category })),
);

/**
 * Ordinary words on their own, so they only count next to a list separator or
 * an explicit skill word. Same rule the tech dictionary applies to "go" and "c".
 *
 * "brand", "funnel", "retention" and "pr" are the dangerous ones: they appear
 * in ordinary prose constantly, and without this a job description mentioning
 * "our brand" would gain a marketing skill it never asked for.
 */
export const BUSINESS_AMBIGUOUS = new Set([
  /*
   * "Agile" is a real methodology and also boilerplate in roughly every job
   * description written since 2010 ("we work in an agile environment"). Left
   * unmarked it became a "required skill" on thousands of postings that were
   * describing their culture, not asking for anything. Marked ambiguous it
   * still counts where it sits in a list of skills, and not where it is
   * scenery.
   */
  "agile",
  "brand",
  "funnel",
  "retention",
  "pr",
  "sem",
  "moz",
  "bob hr",
  "monday",
  "notion",
  "sap",
  "excel",
  "outreach",
  "gong",
  "sourcing",
  "onboarding",
  "מיתוג",
  "משפך",
  "שימור",
  "גיוס",
]);

/** Category union used by the combined matcher. */
export type AnySkillCategory = SkillCategory | BusinessCategory;
