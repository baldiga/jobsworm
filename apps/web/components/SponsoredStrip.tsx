import JobCard from "./JobCard";
import SponsoredImpression from "./SponsoredImpression";
import { getSponsoredJobs } from "@/lib/sponsored";

/**
 * The sponsored strip on the home page.
 *
 * ## Why it is a section of its own, with a heading
 *
 * The promise the whole site rests on is that organic results cannot be
 * bought. That promise is only credible if paid listings are somewhere a
 * reader can point at and say "those are the adverts". Mixing three sponsored
 * cards into a list of organic ones with a small chip would technically
 * disclose it and practically hide it.
 *
 * So: its own `<section>`, its own heading, and a line underneath saying in
 * plain words what the reader is looking at and what it does not affect.
 *
 * ## It renders nothing when there is nothing
 *
 * No empty state, no "no sponsored listings yet" — a reader who has never seen
 * an advert here should not be told that adverts exist. Today that is every
 * reader, and the home page looks exactly as it did.
 */
export default async function SponsoredStrip() {
  const jobs = await getSponsoredJobs(null, {}, 3);
  if (!jobs.length) return null;

  return (
    <section aria-labelledby="sponsored-home" className="mt-10">
      <h2 id="sponsored-home" className="m-0 text-lg font-semibold text-fg">
        Sponsored
      </h2>
      <p className="m-0 mt-1 text-sm text-fg-2">
        Paid, labelled placement. It never changes search results.
      </p>

      <ul className="mt-4 grid list-none gap-3 p-0 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {jobs.map((job, i) => (
          <li key={job.id}>
            <SponsoredImpression
              campaignId={job.sponsored_campaign_id!}
              jobId={job.id}
              surface="home"
              kind={job.sponsored_kind ?? "employer"}
              position={i + 1}
            />
            <JobCard job={job} />
          </li>
        ))}
      </ul>
    </section>
  );
}
