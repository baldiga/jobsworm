import { createHash } from "node:crypto";
import {
  checkSalary,
  checkTotalComp,
  cleanBenefits,
  decompose,
  emailDomain,
  normalizeHe,
  salaryLooksAnnual,
  type SalaryProblem,
} from "@jobsworm/core";

/**
 * Turning a submitted form into a `jobs` row.
 *
 * ## Why a paid listing goes through the same gate as a scraped one
 *
 * It would be easy to argue the opposite: somebody paid, so publish what they
 * wrote. The reason not to is that the index's value is that everything in it
 * is a real, open tech role in Israel. A paid listing that is neither is worth
 * $80 once and costs the credibility of every free listing beside it.
 *
 * So `buildPostedJobRow` runs `decompose()` exactly as ingestion does, and a
 * non-tech submission is refused at the form with a 422 rather than taken and
 * quietly hidden. The buyer finds out immediately, and does not pay.
 *
 * ## Three things the scraped path does not do
 *
 * 1. `is_agency` is FORCED from who is buying, never inferred. An agency's
 *    listing is an agency listing even when the copy is written to read like
 *    an employer's, because the account that submitted it says so.
 * 2. An employer submission whose text reads like an agency's ("our client",
 *    "on behalf of") is flagged for review rather than reclassified. It might
 *    be an employer quoting a customer; that is a judgement for a person, and
 *    silently marking a paying employer as an agency would remove them from
 *    organic search without telling them.
 * 3. The row starts as a `draft` with no expiry. It becomes `open` only when
 *    `activate_campaign` fires — which for a paid listing needs both approval
 *    and payment, and for a free one needs neither.
 *
 * ## The free tier, and why its gate is tighter rather than looser
 *
 * A free listing goes live with no human having read it. That is the whole
 * appeal and the whole danger: a fake vacancy is the cheapest way to collect
 * CVs, and "free and instant" is what makes running one worthwhile. So the
 * automated checks a free listing must pass are STRICTER than a paid one's,
 * not weaker — it must state a real salary, it must send applications to the
 * poster's own domain, and an agency may not post one at all.
 *
 * Salary is required either way. Scraped listings keep whatever their source
 * gave them, because rewriting an employer's own words would be a
 * fabrication — but a listing typed into this form is a field we control, and
 * "no salary stated" is the single most common complaint about every board in
 * this market.
 */

/** Same 300 characters the scraped importer uses. */
const EXCERPT_CHARS = 300;

export interface PostingInput {
  campaignId: string;
  kind: "employer" | "agency";
  /** Free (organic, 7 days, auto-checked) or sponsored (paid, reviewed). */
  plan: "free" | "sponsored";
  /** The account that submitted it. Stored as `jobs.posted_by`. */
  postedBy: string;
  /** The submitting account's address. The free tier checks against it. */
  recruiterEmail?: string | null;
  title: string;
  /** What the card shows. For an agency this may be "Confidential client". */
  companyName: string;
  /**
   * The recruiter's logo at the moment of posting, copied rather than joined.
   *
   * Branding changes; a listing that ran in March should still look like it
   * did in March, and a rebrand must not silently rewrite every past listing.
   */
  companyLogoPath?: string | null;
  companyId?: string | null;
  descriptionText: string;
  locationRaw?: string | null;
  /** A URL or a mailto: address. */
  applyUrl: string;
  /**
   * The recruiter's own reference for this listing, if they gave one. Shown
   * next to the apply button and put into the mailto subject, so applications
   * arrive in a mailbox already sorted. Optional and free text — real ones
   * look like "R-2291", "2026/44" and "REQ 118".
   */
  applyRef?: string | null;
  employmentTypeRaw?: string | null;

  /** Monthly gross base salary in shekels. REQUIRED — see `checkSalary`. */
  salaryMin: number | string | null;
  salaryMax: number | string | null;
  /** Optional total compensation, usually annual. */
  totalCompMin?: number | string | null;
  totalCompMax?: number | string | null;
  totalCompPeriod?: "year" | "month";
  totalCompNote?: string | null;
  /** Checkbox keys from the benefits catalogue in @jobsworm/core. */
  benefits?: unknown;
}

export type PostingRejection =
  | "non_tech"
  | "abroad"
  | "too_short"
  | "no_apply"
  | "agency_cannot_post_free"
  | "apply_domain_mismatch"
  | `salary:${SalaryProblem}`;

export interface PostingResult {
  row: Record<string, unknown> | null;
  reject: PostingRejection | null;
  /** For the admin queue. Never shown to the buyer. */
  flags: string[];
}

/**
 * Text that reads like an agency writing about somebody else's vacancy.
 *
 * Deliberately narrow. These are phrases that only make sense when the writer
 * is not the employer; anything vaguer would flag ordinary copy and turn the
 * admin queue into noise nobody reads.
 */
const CLIENT_SPEAK = [
  // `\b` alone is satisfied by a hyphen, so "our client-side SDK" — ordinary
  // engineering copy — matched `\bour\s+client\b`. The lookahead is the fix.
  /\bour\s+clients?(?![-\w])/i,
  /\bon\s+behalf\s+of\b/i,
  /\ba\s+(?:leading|growing|well[- ]known|stealth)\s+(?:company|startup|firm)\s+is\s+(?:looking|seeking|hiring)/i,
  /\bconfidential\s+client\b/i,
  /הלקוח\s+שלנו/,
  /עבור\s+לקוח/,
  /חברת\s+השמה/,
];

/** A minimum below which there is nothing to decompose and nothing to read. */
const MIN_DESCRIPTION_CHARS = 200;

/** Deliberately loose: this decides mailto-vs-link, not whether mail delivers. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function contentHash(row: Record<string, unknown>): string {
  const { last_seen_at: _l, expires_at: _e, content_hash: _h, ...rest } = row;
  return createHash("sha256")
    .update(JSON.stringify(rest, Object.keys(rest).sort()))
    .digest("hex")
    .slice(0, 32);
}

function fingerprint(company: string, titleNorm: string, city: string | null): string {
  return createHash("sha256")
    .update([company.toLowerCase(), titleNorm, city ?? ""].join("|"))
    .digest("hex")
    .slice(0, 32);
}

export function looksLikeClientWork(text: string): boolean {
  return CLIENT_SPEAK.some((re) => re.test(text));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Whether two hostnames plausibly belong to the same organisation.
 *
 * `acme.com` and `careers.acme.com` do. `acme.com` and `acme-jobs.net` do not,
 * and neither do `acme.co.il` and `evil.com`.
 *
 * The comparison walks up from the right and requires the last two labels to
 * match, plus a third for the Israeli and British two-part suffixes where the
 * last two labels are `co.il` or `co.uk` and carry no identity at all. It is
 * not a public-suffix implementation and does not try to be: getting this
 * slightly wrong costs a free poster one review, and a full PSL dependency to
 * avoid that is not a trade worth making.
 */
export function sameOrganisation(a: string, b: string): boolean {
  const norm = (h: string) => h.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  const x = norm(a);
  const y = norm(b);
  if (!x.length || !y.length) return false;

  const TWO_PART = new Set(["co", "org", "net", "ac", "gov", "muni", "idf", "k12"]);
  const depth = (parts: string[]) =>
    parts.length >= 3 && TWO_PART.has(parts[parts.length - 2]) ? 3 : 2;

  const n = Math.max(depth(x), depth(y));
  if (x.length < n || y.length < n) return false;
  return x.slice(-n).join(".") === y.slice(-n).join(".");
}

export function buildPostedJobRow(input: PostingInput): PostingResult {
  const flags: string[] = [];
  const description = input.descriptionText.trim();
  const applyUrl = input.applyUrl.trim();

  /*
   * Free posting is employers only.
   *
   * A free listing is an ORGANIC listing, and organic search is agency-free —
   * a promise made on the home page, in the terms, and on every agency job
   * page. This would be the one route around it. Also enforced by a check
   * constraint on `campaigns`, because a rule this load-bearing should not
   * rest on any single code path remembering it.
   */
  if (input.plan === "free" && input.kind === "agency") {
    return { row: null, reject: "agency_cannot_post_free", flags };
  }

  if (description.length < MIN_DESCRIPTION_CHARS) {
    return { row: null, reject: "too_short", flags };
  }
  if (!applyUrl) {
    return { row: null, reject: "no_apply", flags };
  }

  // Required on everything posted through Jobsworm. See the header.
  const salary = checkSalary(input.salaryMin, input.salaryMax);
  if (!salary.ok) {
    return { row: null, reject: `salary:${salary.problem!}`, flags };
  }

  const isEmail = /^mailto:/i.test(applyUrl) || EMAIL_SHAPE.test(applyUrl);

  /*
   * Where a free listing may send applications.
   *
   * Requiring the apply address to sit on the poster's own work domain does
   * not make a fake vacancy impossible. It makes it cost a domain and an email
   * account rather than nothing, and it leaves a name attached to the attempt.
   *
   * A PAID listing is exempt: a person reads it before it goes live, and
   * employers legitimately recruit through ATS hosts on somebody else's
   * domain. A free poster who needs that can ask and be reviewed.
   */
  if (input.plan === "free" && input.recruiterEmail) {
    const own = emailDomain(input.recruiterEmail);
    const target = isEmail ? emailDomain(applyUrl.replace(/^mailto:/i, "")) : hostOf(applyUrl);
    if (own && target && !sameOrganisation(own, target)) {
      return { row: null, reject: "apply_domain_mismatch", flags };
    }
  }

  const d = decompose({
    titleRaw: input.title,
    descriptionText: description,
    locationRaw: input.locationRaw ?? null,
    companyName: input.companyName,
    /*
     * `techContext: true` for the same reason the hi-tech boards get it: a
     * marketing or finance role at a tech company is a tech job for this
     * index's purposes, and a paid submission has no `companies.industry` to
     * check against. The `isTech` gate below still refuses a plumbing vacancy.
     */
    techContext: true,
    source: input.kind,
    employmentTypeRaw: input.employmentTypeRaw ?? null,
    // The salary came from its own validated field, so decompose is not asked
    // to guess one out of the prose and cannot contradict it.
    salaryRaw: null,
  });

  if (!d.isTech) return { row: null, reject: "non_tech", flags };
  if (d.location?.abroad) return { row: null, reject: "abroad", flags };

  // See the header: flagged for a person, never reclassified automatically.
  if (input.kind === "employer" && looksLikeClientWork(`${input.title}\n${description}`)) {
    flags.push("looks_like_agency");
  }

  /*
   * A salary that is legal but looks like an annual figure in a monthly field.
   *
   * The ceiling refuses anything above ₪150,000/month, which covers the
   * ordinary annual figure typed into the wrong box. This flag covers the
   * narrow band below it — ₪100,000 to ₪150,000 — where both readings are
   * genuinely possible and a person should decide.
   */
  if (salaryLooksAnnual(salary.value)) flags.push("salary_check_monthly");
  if (d.qualityFlags.length) flags.push(...d.qualityFlags);

  const row: Record<string, unknown> = {
    company_id: input.companyId ?? null,
    company_name_raw: input.companyName,
    company_logo_path: input.companyLogoPath ?? null,
    source_provider: input.kind,
    // The campaign id, so the row is traceable to the purchase and a second
    // write for the same campaign updates rather than duplicates.
    source_external_id: input.campaignId,
    source_url: null,
    fingerprint: fingerprint(input.companyName, d.titleNorm, d.location?.city ?? null),
    posted_by: input.postedBy,

    title_raw: input.title.trim(),
    title_norm: d.titleNorm,
    function: d.function,
    sub_function: d.subFunction,
    seniority: d.seniority,
    req_years_min: d.reqYearsMin,
    req_years_max: d.reqYearsMax,
    employment_type: d.employmentType,
    remote: d.remote,
    hybrid_days_office: d.hybridDaysOffice,
    location: d.location,
    skills_required: d.skillsRequired,
    skills_nice: d.skillsNice,
    tech_stack: d.techStack,
    languages: d.languages,
    education: d.education,
    clearance: d.clearance,
    /*
     * The employer's own validated figure, not one inferred from the prose.
     *
     * `total_comp` is a separate column on purpose: base and TC are different
     * claims, and folding them into one number is exactly how a base of
     * ₪25,000 gets advertised as ₪40,000.
     */
    salary: salary.value,
    total_comp: checkTotalComp(
      input.totalCompMin,
      input.totalCompMax,
      input.totalCompPeriod ?? "year",
      input.totalCompNote,
    ),
    benefits: cleanBenefits(input.benefits),
    decomp_meta: d.decompMeta,
    decomp_version: d.decompVersion,

    apply_url: isEmail && !/^mailto:/i.test(applyUrl) ? `mailto:${applyUrl}` : applyUrl,
    apply_method: isEmail ? ("email" as const) : ("link" as const),
    /*
     * Trimmed and capped here rather than trusted from the form, because the
     * column has a 40-character check and a rejected insert would lose the
     * whole listing over a field nobody had to fill in.
     */
    apply_ref: (() => {
      const ref = String(input.applyRef ?? "").trim();
      return ref ? ref.slice(0, 40) : null;
    })(),

    /*
     * No `description_html`. The buyer's text is stored as text and rendered
     * as text: accepting markup from a paying stranger and putting it on the
     * page is the one place this site would have an XSS hole.
     */
    description_html: null,
    description_text: description,
    description_norm: normalizeHe(description),
    excerpt: description.slice(0, EXCERPT_CHARS),

    lang: d.lang,
    // Not visible until approved AND paid. activate_campaign opens it.
    status: "draft" as const,
    // Forced from the buyer, never from the text.
    is_agency: input.kind === "agency",
    is_social_only: false,
    company_hidden: false,
    quality_flags: d.qualityFlags,
    posted_at: null,
    last_seen_at: new Date().toISOString(),
    // Set at activation, to the campaign's end.
    expires_at: null,
    content_hash: null as string | null,
  };

  row.content_hash = contentHash(row);
  return { row, reject: null, flags };
}
