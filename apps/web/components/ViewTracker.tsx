"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/**
 * Records that this job was opened.
 *
 * Three sinks, counting three different things, and the differences matter:
 *
 * - `/api/views` is the signed-in reader's OWN history — "jobs you viewed" in
 *   My area. A no-op when signed out. Consented personal data, never public.
 * - `sponsored_job_view` goes to PostHog, only for paid listings, so the buyer
 *   can be told how many people opened the card they paid for.
 * - `job_view` on `/api/events` is the ANONYMOUS count, sent for everyone, and
 *   it is the one printed on the card for the world to see.
 *
 * The third is new, and the separation from the first is the whole privacy
 * design: the public number is built only from the anonymous stream, so no
 * consented record changes purpose by being published. A signed-in reader is
 * counted by both, and neither knows about the other.
 *
 * All three wait the same 1.2 seconds. A page abandoned inside a second was
 * not read — charging an advertiser for it would be wrong, and printing it as
 * a view would be a small lie told 4,000 times.
 */
export default function ViewTracker({
  jobId,
  sponsored,
}: {
  jobId: string;
  sponsored?: { campaignId: string; kind: "employer" | "agency" } | null;
}) {
  useEffect(() => {
    const t = setTimeout(() => {
      if (sponsored) {
        track("sponsored_job_view", {
          campaign_id: sponsored.campaignId,
          job_id: jobId,
          kind: sponsored.kind,
        });
      }

      void fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
        keepalive: true,
      }).catch(() => {});

      /*
       * The public counter, deduped in this tab.
       *
       * Once per visit per job, the same rule and the same mechanism as
       * SponsoredImpression. It has to be sessionStorage rather than a server
       * session: the server deliberately learns nothing that could tell two
       * visits apart, so the browser is the only place this can be remembered
       * without giving that up.
       *
       * A reader who reloads is not two readers. A reader who comes back
       * tomorrow, in a new tab, is counted again — which is what "visits"
       * means and what the published definition says.
       */
      try {
        const key = `jv:${jobId}`;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          void fetch("/api/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "job_view", job_id: jobId }),
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        /*
         * sessionStorage throws in a private window and when site data is
         * blocked. Skip the count rather than send an undeduplicated one: an
         * undercount is the error direction we already promise.
         */
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [jobId, sponsored]);

  return null;
}
