import Link from "next/link";
import type { JobRow } from "@/lib/types";
import { publicLogoUrl } from "@/lib/logo";
import ViewCount from "./ViewCount";
import { Chip } from "./ui/Chip";
import HideableCard from "./HideableCard";
import { textProps, dirOf } from "@/lib/direction";
import {
  SOURCE_BADGE,
  EMPLOYMENT,
  REMOTE,
  SENIORITY,
  experienceLabel,
  formatSalary,
  isSponsoredNow,
  locationLabel,
  sponsoredLabel,
  stalePostingLabel,
  timeAgo,
} from "@/lib/format";

/** Two lines of preview is about this many characters at card width. */
const EXCERPT_CHARS = 170;

function preview(raw: string | null): string {
  if (!raw) return "";
  const flat = raw.replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  const cut = flat.slice(0, EXCERPT_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > EXCERPT_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

export default function JobCard({ job }: { job: JobRow }) {
  const city = locationLabel(job.location);
  const salary = formatSalary(job.salary);
  const skills = (job.skills_required?.length ? job.skills_required : job.tech_stack) ?? [];
  const company = job.company_name || (job.company_hidden ? "Undisclosed company" : "");
  const logoUrl = publicLogoUrl(job.company_logo_path);
  /*
   * "Posted" and "first seen" are different claims and the card says which.
   * Social posts carry their own date 98% of the time; for the rest we only
   * know when WE found it, and calling that a posting date invents a fact. It
   * matters most here: nobody deletes an old hiring post the way a job board
   * closes a filled role, so age is the main freshness signal a reader has.
   */
  const posted = job.posted_at ? timeAgo(job.posted_at) : null;
  const seen = !job.posted_at ? timeAgo(job.first_seen_at) : null;
  const stale = stalePostingLabel(job.posted_at, job.first_seen_at);
  const badge = job.source_provider ? SOURCE_BADGE[job.source_provider] : undefined;
  const sponsored = isSponsoredNow(job);
  const yearsLabel = experienceLabel(job.req_years_min, job.req_years_max);

  const title = job.title_raw ?? "";
  const titleProps = textProps(title);
  const excerpt = preview(job.excerpt);
  const excerptDir = dirOf(excerpt);

  return (
    /*
     * The whole card is the hit area. The title keeps the real anchor — so
     * middle-click, "open in new tab" and screen readers all still work — and
     * `card-link` stretches that anchor's hit box over the card via a
     * positioned ::after. Anything that must stay separately clickable inside
     * the card (the company link) is raised above it with `above-hit`.
     *
     * This is why the card is not simply wrapped in an <a>: that would nest the
     * company link inside another link, which is invalid HTML and breaks
     * keyboard navigation.
     */
    <HideableCard jobId={job.id} title={title}>
      <div className="flex items-start gap-3">
        {/*
          The employer's own logo, on listings they posted and paid for.

          Decorative: `alt=""` and aria-hidden, because the company name is
          already the next line of text and a screen reader announcing it twice
          is noise. Sized in a fixed box with `object-contain` so a wide
          wordmark and a square icon both land the same height and the cards
          in a list stay aligned.

          No <Image>: these are 512KB-max files from our own Supabase bucket,
          and putting them through the optimiser would mean a transform per
          card for an asset already smaller than the optimiser's own overhead.
        */}
        {logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoUrl}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="mt-0.5 size-10 shrink-0 rounded-control border border-line bg-surface object-contain p-1"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <h3
            dir={titleProps.dir}
            className={`jobtext ${titleProps.className} leading-snug`}
          >
            <Link
              href={`/jobs/${job.id}`}
              className="card-link outline-offset-4 group-hover:text-action-text"
            >
              {title}
              {/*
                The company in the heading, so a card carries the employer's
                name in the one line a scanner actually reads — and so a
                sponsored listing says whose it is without the reader having to
                look further down.

                Only where there is a logo, which in practice means only on
                listings somebody posted here. Scraped rows already show the
                company on the line below, and repeating it in the title would
                make every card in the index longer to say nothing new.
              */}
              {logoUrl && company ? (
                <span className="font-normal text-fg-2"> — {company}</span>
              ) : null}
            </Link>
          </h3>

          <p className="m-0 mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-fg-2">
            {company ? (
              <span className="jobtext font-medium" dir={dirOf(company)}>
                {company}
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
        </div>

        {/*
          Salary is the highest-value datum on a listing, so it is set as data:
          display face, tabular figures, hairline box. dir="ltr" because
          formatSalary returns "₪28–35K" — the shekel sign is bidi class ET and
          the dash is neutral, so inside RTL text the symbol jumps to the wrong
          end of the range.
        */}
        {salary ? (
          <bdi
            dir="ltr"
            className="numeral shrink-0 rounded-chip border border-line px-2 py-1 text-[15px] font-bold text-fg"
          >
            {salary}
          </bdi>
        ) : null}
      </div>

      {/* First lines of the description, so the list is scannable without a click. */}
      {excerpt ? (
        <div className="mt-2.5">
          <p
            dir={excerptDir}
            className={`jobtext clamp-2 m-0 text-[15px] leading-relaxed text-fg-2 ${
              excerptDir === "rtl" ? "text-right" : "text-left"
            }`}
          >
            {excerpt}
          </p>
          {/*
            Outside the clamped paragraph, not inside it. Inline, the clamp cut
            through the phrase and left "Read" on one line and "more" on the
            next — worse in RTL, where the two halves land on opposite edges.

            It says "View job", not "Read more". The whole card is a link to the
            job page, so this navigates — and a reader told "Read more" quite
            reasonably expects the text to expand where it is. It was reported
            as a bug for exactly that reason. Expanding in place would reveal
            about 130 more characters of an excerpt that is itself truncated,
            and the reader would still have to open the page for the actual
            description; two taps to learn almost nothing. Naming the
            destination is the honest fix.
          */}
          <p
            dir={excerptDir}
            className={`m-0 mt-1 text-[13px] font-medium text-action-text group-hover:underline ${
              excerptDir === "rtl" ? "text-right" : "text-left"
            }`}
          >
            View job
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {/*
          FIRST in the row, and warn-toned, because it changes how everything
          after it should be read. A label a reader finds after the skills has
          already failed at its job.

          `role="note"` rather than a bare chip: to a screen reader "Sponsored"
          out of context is a fragment, and the label names what it is.
        */}
        {sponsored ? (
          <Chip tone="warn">
            <span role="note" aria-label="Sponsored listing" data-sponsored={job.sponsored_kind ?? "employer"}>
              {sponsoredLabel(job)}
            </span>
          </Chip>
        ) : null}
        {job.seniority ? <Chip>{SENIORITY[job.seniority] ?? job.seniority}</Chip> : null}
        {/*
          The years asked for, when the posting says. It is the first thing a
          reader checks and the commonest reason they stop reading, so it
          belongs on the card rather than three clicks away.
        */}
        {yearsLabel ? <Chip>{yearsLabel}</Chip> : null}
        {job.remote && job.remote !== "unknown" ? (
          <Chip tone="info">
            {REMOTE[job.remote]}
            {job.remote === "hybrid" && job.hybrid_days_office
              ? ` · ${job.hybrid_days_office}d office`
              : ""}
          </Chip>
        ) : null}
        {job.employment_type && job.employment_type !== "full_time" ? (
          <Chip>{EMPLOYMENT[job.employment_type] ?? job.employment_type}</Chip>
        ) : null}
        {skills.slice(0, 4).map((s) => (
          <Chip key={s} tone="accent">
            <bdi>{s}</bdi>
          </Chip>
        ))}
        {badge ? <Chip tone={badge.tone}>{badge.label}</Chip> : null}
        {/*
          Last, and warn-toned, because it qualifies everything before it.
          The card already ends with "Posted 84 days ago" in small grey
          text at the bottom, which is easy to read past; this says the same
          thing where the eye already is.
        */}
        {stale ? (
          <Chip tone="warn">
            <span title="This listing may no longer be open. Check the source before applying.">
              {stale}
            </span>
          </Chip>
        ) : null}
      </div>

      {/*
        The date line, with the view count pushed to the far end of it.

        Sharing a row rather than taking one of its own: the count is the same
        weight of information as "posted three days ago", and giving it a line
        would make every card taller for a number most cards do not have. On a
        card with no count the row is exactly what it was before.

        `min-h-4` holds the row's height whether or not the counter resolves,
        so a card does not jump a few pixels a moment after it paints.
      */}
      {posted || seen ? (
        <div className="mt-3 flex min-h-4 items-center justify-between gap-3 text-xs text-fg-2">
          <span>
            {posted ? `Posted ${posted.toLowerCase()}` : `First seen ${seen!.toLowerCase()}`}
          </span>
          <ViewCount jobId={job.id} />
        </div>
      ) : null}
    </HideableCard>
  );
}
