import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createReadClient, supabaseConfigured } from "@/lib/supabase";
import type { JobRow } from "@/lib/types";
import {
  EMPLOYMENT,
  FUNCTION_LABEL,
  REMOTE,
  SENIORITY,
  formatSalary,
  formatTotalComp,
  isSponsoredNow,
  locationLabel,
  sponsoredLabel,
  stalePostingLabel,
  timeAgo,
} from "@/lib/format";
import { benefitLabel } from "@jobsworm/core";
import { textProps, dirOf } from "@/lib/direction";
import ApplyButton from "@/components/ApplyButton";
import SaveButton from "@/components/SaveButton";
import ViewTracker from "@/components/ViewTracker";
import ViewCount from "@/components/ViewCount";
import AppliedToggle from "@/components/AppliedToggle";
import { Chip } from "@/components/ui/Chip";
import { jobBody, safeJsonLd } from "@/lib/sanitize";

export const revalidate = 3600;

type Params = { params: Promise<{ id: string }> };

async function getJob(id: string) {
  if (!supabaseConfigured) return null;
  const supabase = await createReadClient();
  const { data } = await supabase
    .from("jobs")
    .select("*, companies(id, slug, name_en, name_he, domain, industry, size_bucket, careers_url)")
    .eq("id", id)
    .eq("status", "open")
    .maybeSingle();
  return data as (JobRow & { companies: Record<string, string> | null }) | null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return { title: "Job not found" };
  const company = job.companies?.name_en || job.companies?.name_he || job.company_name_raw || "";
  const city = locationLabel(job.location);
  return {
    title: `${job.title_raw}${company ? ` · ${company}` : ""}`,
    description: [company, city, job.excerpt].filter(Boolean).join(" · ").slice(0, 200),
    /*
     * Agency listings are excluded from every search RPC and from the sitemap,
     * so letting Google index them would advertise pages the site itself never
     * shows you — a searcher would arrive from Google at a listing that our own
     * search denies exists. The page stays reachable by direct link; it just
     * stops being a landing page.
     *
     * A LIVE SPONSORED agency listing is the exception: the site does show it,
     * in a labelled slot on the home and search pages, so the reason for
     * hiding it from Google does not apply while the campaign runs.
     */
    ...(job.is_agency && !isSponsoredNow(job) ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function JobPage({ params }: Params) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();

  const sponsored = isSponsoredNow(job);
  const totalComp = formatTotalComp(job.total_comp ?? null);
  const company = job.companies;
  const companyName =
    company?.name_en ||
    company?.name_he ||
    // Scraped sources name the employer in free text, with no companies row.
    job.company_name_raw ||
    (job.company_hidden ? "Undisclosed company" : "");
  const city = locationLabel(job.location);
  const salary = formatSalary(job.salary);
  const posted = timeAgo(job.posted_at ?? job.first_seen_at);
  const seen = timeAgo(job.last_seen_at);
  const stale = stalePostingLabel(job.posted_at, job.first_seen_at);

  /*
   * ATS feeds send real HTML; Facebook and LinkedIn posts send plain text whose
   * paragraph breaks are newlines, into the same column. Rendering the second
   * kind as markup collapsed every newline and produced a wall of text.
   * `jobBody` tells the two apart; the plain branch renders as a text node.
   */
  const body = jobBody(job.description_html, job.description_text);
  const bodyDir = dirOf(body.kind === "empty" ? "" : body.value);

  const title = job.title_raw ?? "";
  const titleProps = textProps(title);
  const isSocialSource = ["facebook", "linkedin"].includes(job.source_provider ?? "");

  const supabase = await createReadClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let alreadyApplied = false;
  if (user) {
    const { data: view } = await supabase
      .from("job_views")
      .select("applied_at")
      .eq("user_id", user.id)
      .eq("job_id", job.id)
      .maybeSingle();
    alreadyApplied = Boolean(view?.applied_at);
  }

  // JobPosting structured data so Google indexes the page (PLAN.md 7.4).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title_raw,
    description: job.description_text?.slice(0, 5000) ?? job.excerpt ?? "",
    datePosted: job.posted_at ?? job.first_seen_at,
    employmentType: job.employment_type?.toUpperCase(),
    directApply: false,
    hiringOrganization: companyName
      ? {
          "@type": "Organization",
          name: companyName,
          sameAs: company?.domain ? `https://${company.domain}` : undefined,
        }
      : undefined,
    jobLocation: city
      ? {
          "@type": "Place",
          address: { "@type": "PostalAddress", addressLocality: city, addressCountry: "IL" },
        }
      : undefined,
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <ViewTracker
        jobId={job.id}
        sponsored={
          sponsored
            ? {
                campaignId: job.sponsored_campaign_id!,
                kind: job.sponsored_kind ?? "employer",
              }
            : null
        }
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />

      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1 text-sm text-fg-2">
        <Link href="/jobs" className="hover:underline">
          Jobs
        </Link>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
        <span className="jobtext truncate" dir={titleProps.dir}>
          {title}
        </span>
      </nav>

      <header className="mb-6">
        <h1
          dir={titleProps.dir}
          className={`jobtext ${titleProps.className} mb-2 text-[28px] font-bold leading-tight sm:text-[34px]`}
        >
          {title}
        </h1>
        <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-fg-2">
          {companyName ? (
            <span className="jobtext font-medium" dir={dirOf(companyName)}>
              {companyName}
            </span>
          ) : null}
          {city ? (
            <>
              <span aria-hidden="true" className="text-line-strong">
                ·
              </span>
              <span>{city}</span>
            </>
          ) : null}
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {/* First, because it changes how everything after it should be read. */}
        {sponsored ? (
          <Chip tone="warn">
            <span role="note" aria-label="Sponsored listing">
              {sponsoredLabel(job)}
            </span>
          </Chip>
        ) : null}
        {salary ? (
          <Chip tone="warn">
            <bdi dir="ltr" className="numeral font-bold">
              {salary}
            </bdi>
            <span>per month</span>
          </Chip>
        ) : null}
        {totalComp ? (
          <Chip>
            <bdi dir="ltr" className="numeral font-bold">
              {totalComp}
            </bdi>
            <span>total comp</span>
          </Chip>
        ) : null}
        {job.seniority ? <Chip>{SENIORITY[job.seniority] ?? job.seniority}</Chip> : null}
        {job.remote && job.remote !== "unknown" ? (
          <Chip tone="info">
            {REMOTE[job.remote]}
            {job.remote === "hybrid" && job.hybrid_days_office
              ? ` · ${job.hybrid_days_office} days in office`
              : ""}
          </Chip>
        ) : null}
        {job.employment_type ? (
          <Chip>{EMPLOYMENT[job.employment_type] ?? job.employment_type}</Chip>
        ) : null}
        {job.function ? <Chip>{FUNCTION_LABEL[job.function] ?? job.function}</Chip> : null}
        {job.clearance ? <Chip tone="warn">Security clearance required</Chip> : null}
      </div>

      <div className="mb-8 rounded-card border border-line bg-surface p-4">
        {/*
          Say so plainly rather than letting someone work it out. Search filters
          agency listings out, so anyone reading this arrived by a direct link
          and has no way of knowing why the job is absent from the index they
          just searched.
        */}
        {job.is_agency && !sponsored ? (
          <p className="m-0 mb-3 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text">
            Agency listing. This posting comes from a recruiting agency, so it is not part of
            Jobsworm&rsquo;s organic index and does not appear in search. You are seeing it because
            you opened it directly.
          </p>
        ) : null}
        {/*
          ABOVE the button, not below it. The reader is being asked to do
          something before they click, and a note underneath is read after the
          decision it was meant to inform — usually not at all.

          Only where the recruiter gave a number. Everything here is optional
          and most listings render exactly as before.
        */}
        {job.apply_ref ? (
          <p className="m-0 mb-3 rounded-card border border-warn-text/20 bg-warn-tint px-3 py-2 text-sm text-warn-text">
            The recruiter asks you to put this job number in your email subject:{" "}
            <bdi dir="ltr" className="numeral font-bold">
              {job.apply_ref}
            </bdi>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <ApplyButton
            jobId={job.id}
            applyUrl={job.apply_url ?? job.source_url ?? "#"}
            applyRef={job.apply_ref}
            title={job.title_raw}
            source={job.source_provider}
            campaignId={sponsored ? job.sponsored_campaign_id : null}
            kind={sponsored ? (job.sponsored_kind ?? "employer") : null}
          />
          <SaveButton jobId={job.id} />
        </div>
        {/*
          A social post was never "confirmed open at the employer" — it is
          somebody's post, and it may have been filled without anyone editing
          it. Saying otherwise is a freshness claim we cannot support.
        */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-fg-2">
          <p className="m-0">
            {isSocialSource
              ? "Posted to a public group or feed. Check the post itself before applying."
              : seen
                ? `Confirmed open at the employer ${seen.toLowerCase()}`
                : "From the employer's careers page"}
            {posted ? ` · Posted ${posted.toLowerCase()}` : null}
          </p>
          {/*
            The same figure as the card, in the box somebody reads before
            deciding to apply — which is where knowing a listing has had
            attention is worth most. Wraps rather than squeezing the freshness
            line on a narrow screen.
          */}
          <ViewCount jobId={job.id} />
        </div>

        {/*
          Who paid, how much, and what that did and did not buy.
          
          The last clause of each sentence is the one that matters: payment
          never changes where jobs rank. Saying it here, on the page somebody
          is about to apply from, is worth more than saying it in the terms.
        */}
        <p className="m-0 mt-2 text-xs text-fg-2">
          {!sponsored ? (
            "Listing published by its original source and linked back to it. The employer did not pay Jobsworm for this listing."
          ) : job.sponsored_kind === "agency" ? (
            <>
              This listing was posted by a recruiting agency, which paid for {job.sponsored_days}{" "}
              days of labelled placement on Jobsworm. Agency listings never appear in organic
              search results, and payment never changes where jobs rank.
            </>
          ) : (
            <>
              This employer paid for {job.sponsored_days} days of labelled placement on Jobsworm.
              Every advertiser pays the same rate for the same number of days, and payment never
              changes where jobs rank in search.
            </>
          )}
        </p>
        {/*
          Said outright on the page somebody applies from, rather than left
          to be inferred from "Posted 14 months ago" in grey. We keep these
          listings because an evergreen requisition can be genuinely open;
          the reader still needs to know before spending an application.
        */}
        {stale ? (
          <p className="m-0 mt-3 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text">
            <strong className="font-semibold">{stale}.</strong> Listings this old are often
            already filled — check the source before you spend time on it.
          </p>
        ) : null}
        {user ? (
          <div className="mt-3 border-t border-line pt-3">
            <AppliedToggle jobId={job.id} applied={alreadyApplied} />
          </div>
        ) : null}
      </div>

      {/*
        Shown as its own section rather than folded into the description,
        because these are structured claims the employer ticked rather than
        prose they wrote. "Sick leave from day one" means the same thing on
        every listing carrying it, which is the entire point of a fixed list.
      */}
      {job.benefits?.length ? (
        <section className="mb-6">
          <h2 className="mb-2 text-lg">What comes with it</h2>
          <div className="flex flex-wrap gap-1.5">
            {job.benefits.map((b) => (
              <Chip key={b} tone="info">
                {benefitLabel(b)}
              </Chip>
            ))}
          </div>
        </section>
      ) : null}

      {job.skills_required?.length ? (
        <section className="mb-6">
          <h2 className="mb-2 text-lg">Requirements</h2>
          <div className="flex flex-wrap gap-1.5">
            {job.skills_required.map((s) => (
              <Chip key={s} tone="accent">
                <bdi>{s}</bdi>
              </Chip>
            ))}
          </div>
        </section>
      ) : null}

      {job.skills_nice?.length ? (
        <section className="mb-6">
          <h2 className="mb-2 text-lg">Nice to have</h2>
          <div className="flex flex-wrap gap-1.5">
            {job.skills_nice.map((s) => (
              <Chip key={s}>
                <bdi>{s}</bdi>
              </Chip>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-lg">Job description</h2>
        {body.kind === "html" ? (
          <div
            dir={bodyDir}
            className={`jobprose jobtext text-fg-2 ${bodyDir === "rtl" ? "text-right" : "text-left"}`}
            dangerouslySetInnerHTML={{ __html: body.value }}
          />
        ) : body.kind === "plain" ? (
          /* Rendered as a text node — escaped by React, newlines kept by CSS. */
          <p
            dir={bodyDir}
            className={`jobprose jobprose--plain jobtext m-0 text-fg-2 ${
              bodyDir === "rtl" ? "text-right" : "text-left"
            }`}
          >
            {body.value}
          </p>
        ) : (
          <p className="m-0 text-fg-2">
            This listing has no description. Open it at the source for the full details.
          </p>
        )}
      </section>

      <p className="m-0 text-xs text-fg-2">
        Listing published by its original source and linked back to it. Jobsworm does not
        receive payment from employers.
      </p>
    </div>
  );
}
