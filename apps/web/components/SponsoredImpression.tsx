"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";

/**
 * Counts one impression of one sponsored card.
 *
 * ## What "an impression" means here, exactly
 *
 * The card was at least half visible for a full second, once per visit per
 * surface. That definition is on the recruiter dashboard in as many words,
 * because "impressions" is a word advertisers have been sold a hundred
 * different meanings of, and the only useful thing to do is say which one this
 * is and then hold to it.
 *
 * Every clause is doing work:
 *
 * - **Half visible**, not merely rendered. A card below the fold that nobody
 *   scrolled to has not been seen, and counting it would be charging for it.
 * - **A full second**, so a fast scroll past does not count. `IntersectionObserver`
 *   fires the moment the threshold is crossed; the timer is what turns "was on
 *   screen" into "was there long enough to read".
 * - **Once per visit per surface**, in `sessionStorage`. Without it, scrolling
 *   up and down a search page would multiply one viewing into a dozen
 *   impressions, and the number an advertiser pays attention to would be a
 *   measure of how fidgety the reader is.
 *
 * `sessionStorage` and not `localStorage`: the dedupe should last a visit, not
 * a lifetime. A person who comes back tomorrow has genuinely seen the card
 * again.
 *
 * ## Undercounting, on purpose
 *
 * A tracking blocker stops this, so real impressions exceed reported ones. The
 * dashboard says so. An undercount we can describe is worth more than an
 * overcount we cannot, and it is the only direction of error that is fair to
 * the person paying.
 */

const VISIBLE_FRACTION = 0.5;
const DWELL_MS = 1000;

export default function SponsoredImpression({
  campaignId,
  jobId,
  surface,
  kind,
  position,
}: {
  campaignId: string;
  jobId: string;
  surface: "home" | "search";
  kind: "employer" | "agency";
  position: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const key = `imp:${surface}:${campaignId}`;
    // Storage throws in some privacy modes. A page must not fail to render
    // because a counter could not read a flag.
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      /* carry on and count it; at worst this visit counts twice */
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_FRACTION) {
            if (timer) continue;
            timer = setTimeout(() => {
              try {
                sessionStorage.setItem(key, "1");
              } catch {
                /* ignore */
              }
              track("sponsored_impression", {
                campaign_id: campaignId,
                job_id: jobId,
                surface,
                kind,
                position,
              });
              observer.disconnect();
            }, DWELL_MS);
          } else if (timer) {
            // Scrolled away before the second was up. Not an impression.
            clearTimeout(timer);
            timer = null;
          }
        }
      },
      { threshold: [VISIBLE_FRACTION] },
    );

    observer.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [campaignId, jobId, surface, kind, position]);

  // A zero-size marker rather than a wrapper, so this cannot affect layout.
  return <span ref={ref} aria-hidden="true" />;
}
