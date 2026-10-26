import "server-only";
import { randomUUID } from "node:crypto";
import {
  FREE_DAYS,
  PACKAGES,
  SALARY_MAX_ILS,
  SALARY_MIN_ILS,
  planPriceUsd,
  pricePerDayUsd,
} from "@jobsworm/core";
import { buildPostedJobRow, type PostingRejection } from "@jobsworm/adapters/posting";
import type { Recruiter } from "./recruit";

/**
 * The shared half of creating and editing a campaign.
 *
 * Both routes run the same validation and build the same row, because the two
 * drifting apart is how an edit ends up publishing something the create path
 * would have refused. Whatever a recruiter can do at submission they can do on
 * the second attempt, and no more.
 */

export type CampaignBody = {
  title?: string;
  company_name?: string;
  city?: string | null;
  remote?: string;
  employment_type?: string;
  seniority?: string | null;
  description?: string;
  apply_to?: string;
  apply_ref?: string;
  salary_min?: string | number | null;
  salary_max?: string | number | null;
  tc_min?: string | number | null;
  tc_max?: string | number | null;
  tc_period?: "year" | "month";
  benefits?: unknown;
  plan?: "free" | "sponsored";
  days?: number;
};

/**
 * What the recruiter is told when a submission is refused.
 *
 * One message per rejection, each naming the thing to change. A 422 that says
 * "invalid" makes somebody guess; these are the six things that can actually
 * be wrong.
 */
export const REJECTION_TEXT: Record<string, string> = {
  non_tech: "Jobsworm lists tech roles only.",
  abroad: "Jobsworm lists roles in Israel only.",
  too_short: "The description is too short. Tell people what the job actually involves.",
  no_apply: "Add a link or an email address for applications.",
  agency_cannot_post_free:
    "Agency listings appear in sponsored slots only, so they cannot use the free option. Choose a paid length and your listing will be labelled as an agency listing.",
  apply_domain_mismatch:
    "A free listing must send applications to your own company's domain. Use an address or link on your domain, or choose a paid length — paid listings are reviewed by a person and can apply anywhere.",
  "salary:missing": "Add the salary range. Every listing posted through Jobsworm shows one.",
  "salary:not_a_number": "Enter the salary as numbers, without currency symbols.",
  "salary:below_minimum": `The salary is below ₪${SALARY_MIN_ILS.toLocaleString("en-IL")} a month. This field is monthly gross base salary.`,
  "salary:above_maximum": `The salary is above ₪${SALARY_MAX_ILS.toLocaleString("en-IL")} a month. This field is monthly base salary, not annual.`,
  "salary:inverted": "The top of the salary range is lower than the bottom.",
};

export function rejectionMessage(reject: PostingRejection): string {
  return REJECTION_TEXT[reject] ?? "That listing cannot be published as written.";
}

export type Prepared =
  | { ok: false; reject: PostingRejection }
  | {
      ok: true;
      campaignId: string;
      plan: "free" | "sponsored";
      days: number;
      priceUsd: number;
      perDayUsd: number;
      row: Record<string, unknown>;
      flags: string[];
      form: Record<string, unknown>;
    };

/**
 * Validate a submission and build everything both routes need to write.
 *
 * `campaignId` is generated HERE rather than by the database, because the job
 * row carries it as `source_external_id` and the two must be written together.
 * On an edit the existing id is passed in, so the job's identity is stable
 * across edits and the unique constraint keeps doing its job.
 */
export function prepareCampaign(
  recruiter: Recruiter,
  body: CampaignBody,
  existingCampaignId?: string,
): Prepared {
  const campaignId = existingCampaignId ?? randomUUID();

  /*
   * The plan is decided here, from the recruiter's kind and what they asked
   * for — never taken from the body alone. An agency asking for `free` is
   * refused by `buildPostedJobRow` below and again by a check constraint;
   * clamping it silently here would hide a deliberate attempt rather than
   * report it.
   */
  const plan: "free" | "sponsored" = body.plan === "free" ? "free" : "sponsored";
  const requested = Number(body.days);
  const days =
    plan === "free"
      ? FREE_DAYS
      : (PACKAGES as readonly number[]).includes(requested)
        ? requested
        : // An unrecognised length is not an error worth a round trip — the
          // form only offers four — so it falls back to the shortest paid one,
          // which is the cheapest thing to charge somebody by accident.
          PACKAGES[0];

  const { row, reject, flags } = buildPostedJobRow({
    campaignId,
    kind: recruiter.kind,
    plan,
    postedBy: recruiter.user_id,
    recruiterEmail: recruiter.contact_email,
    title: String(body.title ?? ""),
    companyName: String(body.company_name ?? recruiter.org_name),
    // From the profile, never from the request body: the logo is a thing the
    // recruiter uploaded through a route that checked its bytes, and a path
    // accepted from a form would let anyone point a listing at any object.
    companyLogoPath: recruiter.logo_path ?? null,
    companyId: recruiter.kind === "employer" ? recruiter.company_id : null,
    descriptionText: String(body.description ?? ""),
    locationRaw: body.city ? String(body.city) : null,
    applyUrl: String(body.apply_to ?? ""),
    applyRef: body.apply_ref ? String(body.apply_ref) : null,
    employmentTypeRaw: body.employment_type ? String(body.employment_type) : null,
    salaryMin: body.salary_min ?? null,
    salaryMax: body.salary_max ?? null,
    totalCompMin: body.tc_min ?? null,
    totalCompMax: body.tc_max ?? null,
    totalCompPeriod: body.tc_period === "month" ? "month" : "year",
    benefits: body.benefits,
  });

  if (reject || !row) return { ok: false, reject: reject ?? "too_short" };

  /*
   * The form's own answers override decompose where the recruiter stated them
   * outright. Decomposition exists to read a posting nobody filled in for us;
   * when somebody has picked "Hybrid" from a list, guessing from the prose is
   * worse information, not better.
   */
  if (body.remote && ["onsite", "hybrid", "remote"].includes(String(body.remote))) {
    row.remote = body.remote;
  }
  if (body.seniority) row.seniority = body.seniority;
  if (body.employment_type) row.employment_type = body.employment_type;

  return {
    ok: true,
    campaignId,
    plan,
    days,
    priceUsd: planPriceUsd(plan, days),
    perDayUsd: plan === "free" ? 0 : pricePerDayUsd(days),
    row,
    flags,
    // Kept verbatim, so "what did they actually submit" is answerable after any
    // amount of later re-decomposition.
    form: { ...body } as Record<string, unknown>,
  };
}
