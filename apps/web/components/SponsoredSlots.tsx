import JobCard from "./JobCard";
import SponsoredImpression from "./SponsoredImpression";
import type { JobRow } from "@/lib/types";

/**
 * Sponsored cards above a page of search results.
 *
 * Takes rows rather than fetching them, because the search page already runs
 * its queries in one `Promise.all` and a component that fetched on its own
 * would add a serial round trip to the slowest page on the site.
 *
 * ## What it must not do
 *
 * - It must not change `total`. The count above the list, and the `aria-live`
 *   announcement that goes with it, describe the organic result set. Two paid
 *   cards do not mean two more jobs matched.
 * - It must not appear past page 1. A reader on page 4 is deep in a specific
 *   search; interrupting it repeatedly is the behaviour that makes people
 *   install blockers.
 * - It must not repeat a card that is already in the organic list. That is
 *   handled by the caller, which filters the organic rows by the sponsored
 *   ids — an employer who paid should get their labelled slot, not the same
 *   listing twice.
 *
 * ## Rendered twice per page
 *
 * Three above the results and three below. Two copies of one component in one
 * document means the heading id cannot be a constant — a repeated id is
 * invalid, and `aria-labelledby` then resolves to whichever came first, so a
 * screen reader would announce the lower block under the upper block's
 * heading. `position` distinguishes them, and it also fixes the copy: "the
 * results below" is false when there is nothing below.
 */
export default function SponsoredSlots({
  jobs,
  position = "above",
}: {
  jobs: JobRow[];
  position?: "above" | "below";
}) {
  if (!jobs.length) return null;

  const below = position === "below";
  const headingId = `sponsored-search-${position}`;

  return (
    /*
     * A rule underneath, because what follows is a different KIND of thing.
     *
     * The heading says these are paid and that they do not affect the results
     * below, and then the sponsored cards and the organic ones ran together in
     * one evenly spaced column — so the sentence was doing all the work of
     * separating them and the layout was doing none. The line is where the
     * claim becomes visible: above it, advertising; below it, search results.
     *
     * Only here. The home strip has nothing after it, so a rule there would be
     * a line drawn above empty space.
     */
    <section
      aria-labelledby={headingId}
      // The rule goes between the adverts and the results either way, so it
      // moves to the top of the block when the block is underneath them.
      className={below ? "mt-5 border-t border-line pt-5" : "mb-5 border-b border-line pb-5"}
    >
      <h2 id={headingId} className="m-0 text-sm font-semibold text-fg-2">
        Sponsored
      </h2>
      <p className="m-0 mt-0.5 text-xs text-fg-2">
        {below
          ? "Paid, labelled placement. It never changes the results above."
          : "Paid, labelled placement. It never changes the results below."}
      </p>

      <ul className="mt-3 grid list-none gap-3 p-0">
        {jobs.map((job, i) => (
          <li key={job.id}>
            <SponsoredImpression
              campaignId={job.sponsored_campaign_id!}
              jobId={job.id}
              surface="search"
              kind={job.sponsored_kind ?? "employer"}
              // Continues the numbering rather than restarting, so slot 4 in
              // the analytics is the first card below the results and not a
              // second copy of slot 1.
              position={below ? i + 4 : i + 1}
            />
            <JobCard job={job} />
          </li>
        ))}
      </ul>
    </section>
  );
}
