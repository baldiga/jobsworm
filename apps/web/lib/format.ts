import { usdToIls } from "@jobsworm/core";

/**
 * Display labels for the English interface.
 *
 * The stored values are stable enum keys ("tel_aviv", "mid", "hybrid"); only
 * the presentation is English. Employer-written text — titles, descriptions,
 * company names — is never translated, because rewriting what an employer
 * actually said would be a fabrication. It is rendered as written, with its own
 * direction (see lib/direction.ts).
 */

export const REGION: Record<string, string> = {
  tel_aviv: "Tel Aviv & Center",
  center: "Center",
  sharon: "Sharon",
  shfela: "Shfela",
  jerusalem: "Jerusalem",
  haifa: "Haifa",
  north: "North",
  south: "South",
  abroad: "Abroad",
};

export const REMOTE: Record<string, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
  unknown: "Not stated",
};

export const SENIORITY: Record<string, string> = {
  student: "Student",
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Team lead",
  manager: "Manager",
  director: "Director",
  exec: "Executive",
};

export const FUNCTION_LABEL: Record<string, string> = {
  software_engineering: "Software engineering",
  data: "Data",
  devops: "DevOps & SRE",
  qa: "QA & automation",
  security: "Security",
  it_support: "IT & support",
  product: "Product",
  design: "Design & UX",
  hardware: "Hardware & embedded",
  ai_ml: "AI & ML",
  tech_pm: "Project management",
  technical_writing: "Technical writing",
  solutions_engineering: "Solutions engineering",
  sales: "Sales",
  marketing: "Marketing",
  customer_success: "Customer success",
  finance: "Finance",
  hr: "HR",
  operations: "Operations",
  legal: "Legal",
  non_tech: "Other",
};

export const EMPLOYMENT: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  freelance: "Freelance",
  student: "Student role",
  internship: "Internship",
};

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 60) return "Less than an hour ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

/**
 * A posting is marked as old past this many days.
 *
 * Sixty is chosen against how the sources actually behave. Social posts expire
 * 21 days after they were written and board listings 14 days after we last saw
 * them, so almost nothing that reaches this age is a scraped row — it is an
 * employer's own ATS requisition, which carries no expiry because the feed is
 * supposed to close it. Some never do: an audit of the live index found 105
 * open jobs over a year old and 43 over two, including a Palantir posting
 * dated 2012.
 *
 * They are not deleted, because an evergreen requisition can be genuinely
 * open, and closing it would tell a reader something we do not know. Saying
 * how old it is tells them exactly what we do know.
 */
export const STALE_POSTING_DAYS = 60;

/** Whole days since a job was posted, falling back to when we first saw it. */
export function ageInDays(
  postedAt: string | null | undefined,
  firstSeenAt?: string | null | undefined,
): number | null {
  const iso = postedAt ?? firstSeenAt;
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  return days < 0 ? 0 : days;
}

/**
 * "84-day-old posting", or null when the job is recent enough not to warrant
 * the warning. Hyphenated because it modifies "posting" — this is one label,
 * not a sentence.
 */
export function stalePostingLabel(
  postedAt: string | null | undefined,
  firstSeenAt?: string | null | undefined,
): string | null {
  const days = ageInDays(postedAt, firstSeenAt);
  if (days === null || days < STALE_POSTING_DAYS) return null;
  return `${days}-day-old posting`;
}

type SalaryShape = {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
  period?: string | null;
  raw?: string | null;
} | null;

export function formatSalary(salary: SalaryShape): string | null {
  if (!salary) return null;
  const { min, max, currency } = salary;
  if (!min && !max) return salary.raw ?? null;
  const sign = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₪";
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n));
  if (min && max) return `${sign}${k(min)}–${k(max)}`;
  return `${sign}${k((min ?? max) as number)}+`;
}

/**
 * Common Israeli place names in English.
 *
 * Locations arrive as free text from the source, usually Hebrew. Unlike job
 * copy, a place name has a settled English form, so mapping it is a
 * translation rather than a rewrite. Anything unrecognised falls through
 * unchanged rather than being dropped.
 */
const CITY_EN: Record<string, string> = {
  "תל אביב": "Tel Aviv",
  "תל אביב יפו": "Tel Aviv",
  "תל אביב-יפו": "Tel Aviv",
  "רמת גן": "Ramat Gan",
  "גבעתיים": "Givatayim",
  "הרצליה": "Herzliya",
  "הרצליה פיתוח": "Herzliya",
  "רעננה": "Ra'anana",
  "כפר סבא": "Kfar Saba",
  "פתח תקווה": "Petah Tikva",
  "פתח תקוה": "Petah Tikva",
  "ראשון לציון": "Rishon LeZion",
  "רחובות": "Rehovot",
  "נס ציונה": "Ness Ziona",
  "חולון": "Holon",
  "בת ים": "Bat Yam",
  "ירושלים": "Jerusalem",
  "חיפה": "Haifa",
  "באר שבע": "Beer Sheva",
  "נתניה": "Netanya",
  "אשדוד": "Ashdod",
  "אשקלון": "Ashkelon",
  "מודיעין": "Modiin",
  "יקנעם עילית": "Yokneam",
  "יקנעם": "Yokneam",
  "כרמיאל": "Karmiel",
  "עפולה": "Afula",
  "טירת הכרמל": "Tirat Carmel",
  "קיסריה": "Caesarea",
  "אור יהודה": "Or Yehuda",
  "לוד": "Lod",
  "רמלה": "Ramla",
  "בני ברק": "Bnei Brak",
  "מגדל העמק": "Migdal HaEmek",
  "עומר": "Omer",
  "שוהם": "Shoham",
  "רמת השרון": "Ramat HaSharon",
  "הוד השרון": "Hod HaSharon",
  "ישראל": "Israel",
};

export function cityEn(name: string): string {
  const key = name.trim();
  return CITY_EN[key] ?? key;
}

export function locationLabel(location: unknown): string {
  if (!location || typeof location !== "object") return "";
  const loc = location as { cities?: string[]; city?: string; raw?: string; abroad?: boolean };
  if (loc.cities?.length) return loc.cities.slice(0, 2).map(cityEn).join(" · ");
  const one = loc.city || loc.raw || "";
  return one ? cityEn(one) : "";
}

/**
 * Where a posting came from. ATS-sourced jobs are the canonical ones, pulled
 * straight from the employer's own feed, so they carry no badge. The
 * supplementary link-out sources do, because the user is about to leave for a
 * job board rather than the employer.
 */
export const SOURCE_BADGE: Record<string, { label: string; tone: "info" | "warn" }> = {
  alljobs: { label: "via AllJobs", tone: "warn" },
  drushim: { label: "via Drushim", tone: "warn" },
  yad2: { label: "via Yad2", tone: "warn" },
  facebook: { label: "Facebook group", tone: "info" },
  linkedin: { label: "LinkedIn post", tone: "info" },
  // The feed's own `attribution.name`. Displaying it is a condition of the
  // partner feed, not a nicety.
  drushimavodot: { label: "via דרושים - עבודות", tone: "warn" },
  secrettelaviv: { label: "via Secret Tel Aviv", tone: "warn" },
  // Paid placement. The employer wrote this listing and submitted it here, so
  // it is the most direct provenance there is — which the badge should say
  // even though the sponsored chip beside it says who paid.
  employer: { label: "Posted by the employer", tone: "info" },
  agency: { label: "Posted by a recruiting agency", tone: "warn" },
};

const ATS_PROVIDERS = new Set([
  "comeet", "greenhouse", "lever", "ashby", "workable",
  "smartrecruiters", "recruitee", "workday", "personio", "bamboohr",
]);

export function isDirectFromEmployer(source: string | null | undefined): boolean {
  return Boolean(source && ATS_PROVIDERS.has(source));
}

/* ------------------------------------------------------------------------- */
/* Paid placement                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Whether a listing is a live sponsored one, right now.
 *
 * The date is re-checked in the browser rather than trusted from the query,
 * because a page can be cached and served minutes after `sponsored_jobs()`
 * decided it was live. A card that says "Sponsored" after the campaign ended
 * is a small lie told to a reader and a real one told to the next advertiser.
 */
export function isSponsoredNow(job: {
  sponsored_until?: string | null;
  sponsored_campaign_id?: string | null;
}): boolean {
  if (!job.sponsored_campaign_id || !job.sponsored_until) return false;
  const until = new Date(job.sponsored_until).getTime();
  return !Number.isNaN(until) && until > Date.now();
}

/** "$80". Whole dollars: the package prices are whole dollars by construction. */
export function formatUsd(amount: number | string | null | undefined): string | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return null;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * The same figure in shekels, for a reader who thinks in shekels.
 *
 * Always shown as an approximation, because it is one: the charge is in
 * dollars at a rate the card issuer picks on the day, and this is a fixed 3.2
 * so the page and the listing cannot disagree with each other. Printing it as
 * an exact "₪256" would be claiming to know what will land on the statement.
 */
export function formatIlsApprox(usd: number | string | null | undefined): string | null {
  if (usd === null || usd === undefined || usd === "") return null;
  const n = typeof usd === "string" ? Number(usd) : usd;
  if (!Number.isFinite(n)) return null;
  return `≈₪${usdToIls(n).toLocaleString("en-IL")}`;
}

/**
 * The label on a sponsored card.
 *
 *   employer -> "Sponsored"
 *   agency   -> "Sponsored · Agency"
 *
 * ## Why the price used to be here, and why it is not any more
 *
 * It read "Sponsored · employer paid $80". The argument was transparency: a
 * reader could weigh a listing knowing what somebody spent to put it in front
 * of them, and an advertiser who knows the figure is printed cannot later
 * claim the placement was editorial.
 *
 * That argument needs an auction behind it. It does not have one. Placement is
 * a fixed price for a fixed number of days, the same rate for everybody, and
 * nothing is bid — so the number tells a reader nothing they can act on. Two
 * listings side by side showing $42 and $145 look like they bought different
 * amounts of prominence, and they did not: one bought a week and the other
 * bought four.
 *
 * So a figure that cannot inform a decision was inviting a false one. What
 * matters is the disclosure itself — this is advertising, and it is not in the
 * organic results — and that survives without the price. The amount is still
 * recorded, still on the recruiter's own dashboard, and still on their
 * receipt. It is simply not a public number.
 */
export function sponsoredLabel(job: { sponsored_kind?: "employer" | "agency" | null }): string {
  return job.sponsored_kind === "agency" ? "Sponsored · Agency" : "Sponsored";
}

/* ------------------------------------------------------------------------- */
/* Total compensation                                                         */
/* ------------------------------------------------------------------------- */

type TotalCompShape = {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
  period?: string | null;
  note?: string | null;
} | null;

/**
 * "₪450K–600K per year".
 *
 * Rendered separately from the base salary and never merged with it. Folding
 * equity into a headline figure is how a base of ₪25,000 gets advertised as
 * ₪40,000, and the whole reason the two are different columns.
 */
export function formatTotalComp(tc: TotalCompShape): string | null {
  if (!tc || !tc.min || !tc.max) return null;
  const sign = tc.currency === "USD" ? "$" : tc.currency === "EUR" ? "€" : "₪";
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n));
  const range = tc.min === tc.max ? `${sign}${k(tc.min)}` : `${sign}${k(tc.min)}–${k(tc.max)}`;
  return `${range} ${tc.period === "month" ? "per month" : "per year"}`;
}

/**
 * "3+ yrs", "3–5 yrs", or nothing.
 *
 * Abbreviated because it sits in a row of chips beside the seniority and the
 * work setup, and "years of experience" would crowd out the things next to it.
 * Returns null when the posting never said — which is about a third of them,
 * and inventing a figure there would be worse than staying quiet.
 */
export function experienceLabel(
  min: number | null | undefined,
  max: number | null | undefined,
): string | null {
  if (min == null || min <= 0) return null;
  if (max != null && max > min) return `${min}–${max} yrs`;
  return `${min}+ yrs`;
}
