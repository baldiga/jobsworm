"use client";

import { useState } from "react";
import { track } from "@/lib/analytics";
import { ArrowUpRight } from "lucide-react";

/**
 * Where this link actually goes, said plainly.
 *
 * Three destinations, three different experiences, and conflating them is a
 * small dishonesty that makes the whole index feel unreliable:
 *
 *   ATS      the employer's own system. An application form. Best case.
 *   BOARD    a job board relay. You apply on their site, and both AllJobs and
 *            Drushim ask you to register first (free, but it is a step).
 *   SOCIAL   somebody's post. "Applying" usually means a comment or a DM.
 *
 * A NOTE ON "PREMIUM": AllJobs pages carry the word VIP over two hundred times,
 * but reading the surrounding markup shows it is an EMPLOYER package — "מחיקת
 * משרה ללקוח VIP בלבד", job deletion for VIP clients only. It gates recruiter
 * features, not seeker access, and AllJobs' own header offers "הרשמה בחינם
 * לאתר". No per-listing paywall was found on either board, so nothing here
 * claims one. A wrong "requires premium" badge would tell people not to bother
 * with jobs they can apply to for nothing, which is worse than saying less.
 */
const SOCIAL_SOURCES = new Set(["facebook", "linkedin"]);

/** Job boards that relay a listing rather than hosting the employer's form. */
const BOARD_LABEL: Record<string, string> = {
  alljobs: "AllJobs",
  drushim: "Drushim",
  drushimavodot: "Drushim-Avodot",
  yad2: "Yad2",
};

export default function ApplyButton({
  jobId,
  applyUrl,
  applyRef,
  title,
  source,
  campaignId,
  kind,
}: {
  jobId: string;
  applyUrl: string;
  /** The recruiter's job number, if they gave one. Goes in the mail subject. */
  applyRef?: string | null;
  /** Only used to build that subject line. */
  title?: string | null;
  /** `jobs.source_provider`. Decides what this button honestly promises. */
  source?: string | null;
  /** Set on a live sponsored listing, so the click reaches the buyer's stats. */
  campaignId?: string | null;
  kind?: "employer" | "agency" | null;
}) {
  const [going, setGoing] = useState(false);

  const key = String(source ?? "");
  const isSocial = SOCIAL_SOURCES.has(key);
  const board = BOARD_LABEL[key];
  const isEmail = /^mailto:/i.test(applyUrl);
  const isAgency = kind === "agency";

  /*
   * Put the job number in the subject rather than only asking for it.
   *
   * The note above the button asks; this means the reader does not have to
   * act on the request at all, which is the difference between a recruiter
   * getting a sorted mailbox sometimes and getting one reliably.
   *
   * Only when the target is an email and the recruiter gave a number, and only
   * when they have not already written their own `subject=` into the address —
   * overwriting that would be taking a decision away from them.
   */
  const href = (() => {
    if (!isEmail || !applyRef) return applyUrl;
    if (/[?&]subject=/i.test(applyUrl)) return applyUrl;
    const subject = title ? `${applyRef} — ${title}` : applyRef;
    const sep = applyUrl.includes("?") ? "&" : "?";
    return `${applyUrl}${sep}subject=${encodeURIComponent(subject)}`;
  })();

  function logClick() {
    setGoing(true);
    /*
     * Two sinks, on purpose. The `events` table is what `site_stats` counts
     * for the home page's "Applications made"; PostHog is what a recruiter is
     * shown for their own campaign. Neither can stand in for the other, and
     * neither may delay the redirect.
     */
    track("apply_click", {
      job_id: jobId,
      source: source ?? null,
      campaign_id: campaignId ?? null,
      kind: kind ?? null,
    });
    try {
      const body = JSON.stringify({ name: "apply_click", job_id: jobId });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      } else {
        void fetch("/api/events", { method: "POST", body, keepalive: true });
      }
    } catch {
      // Never block the apply on analytics.
    }
  }

  /*
   * Say where the click goes, and to whom. "Apply on the employer's site" on
   * an agency listing is not true, and it is the exact misdirection people
   * resent about agency postings elsewhere.
   */
  const label = going
    ? isSocial
      ? "Opening the post…"
      : isEmail
        ? "Opening your email…"
        : "Opening the listing…"
    : isSocial
      ? "See post"
      : isEmail
        ? "Apply by email"
        : board
          ? `Apply on ${board}`
          : isAgency
            ? "Apply with the agency"
            : "Apply on the employer’s site";

  return (
    <div className="w-full sm:w-auto">
      <a
        href={href}
        // A mailto: handed to a new tab leaves an empty tab behind on most
        // browsers. Everything else genuinely leaves the site.
        target={isEmail ? undefined : "_blank"}
        rel="noopener noreferrer nofollow"
        onClick={logClick}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-action px-6 py-3 font-medium text-on-action transition-colors hover:bg-action-hover sm:w-auto"
      >
        {label}
        {/* The arrow points away from the text, so it mirrors under RTL. */}
        <ArrowUpRight aria-hidden="true" className="size-[18px] shrink-0 rtl:-scale-x-100" />
      </a>

      {/*
        Say the account step before the click, not after. Being sent to a
        registration wall you were not warned about is the moment a listing
        starts to feel like a bait link.
      */}
      {board ? (
        <p className="m-0 mt-2 text-xs text-fg-2">
          {board} usually asks you to register before applying. Registration is free.
        </p>
      ) : null}

      {isAgency ? (
        <p className="m-0 mt-2 text-xs text-fg-2">
          This role is handled by a recruiting agency, which paid for this listing.
        </p>
      ) : null}
    </div>
  );
}
