/**
 * PostHog, loaded once per browser session.
 *
 * `instrumentation-client.ts` is a Next file convention: this module is
 * executed on the client before the app hydrates, which is the earliest point
 * at which a page view can be captured and the only place `posthog.init` can
 * be called exactly once.
 *
 * ## Everything here is a deliberate departure from the defaults
 *
 * `api_host: "/hive"` routes every request through this site's own origin (see
 * the rewrites in `next.config.ts`). PostHog's own hostnames are on every
 * blocklist shipped with every content blocker, so without the proxy a large
 * and *non-random* share of visitors disappears — disproportionately the
 * technical ones, which is to say exactly the audience of an Israeli tech job
 * board. A recruiter paying for impressions deserves a count that is not
 * skewed by who runs uBlock.
 *
 * `persistence: "localStorage"` sets no cookie at all, which is what the
 * privacy notice promises.
 *
 * `person_profiles: "identified_only"` plus never calling `identify()`
 * anywhere in the codebase means no person record is ever created. Events are
 * anonymous by construction rather than by policy.
 *
 * `autocapture: false` because autocapture records the text of elements people
 * click, and on this site that includes job titles and, on the CV screen,
 * chips built out of somebody's own skills.
 *
 * `disable_session_recording: true` because session replay would record people
 * typing into the search box. The privacy copy says it does not happen; this
 * is the line that makes that true, and it is belt-and-braces with the project
 * setting, since the project default is ON.
 */
import posthog from "posthog-js";
import { stripTrackedParams } from "@/lib/analytics";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "/hive",
    ui_host: "https://eu.posthog.com",
    // Captures a pageview on App Router navigations, not just full loads.
    defaults: "2025-05-24",
    persistence: "localStorage",
    person_profiles: "identified_only",
    autocapture: false,
    disable_session_recording: true,
    capture_pageleave: false,
    // Honour the browser's own signal without being asked to.
    respect_dnt: true,
    /*
     * The last line of defence for the search query.
     *
     * `track()` is careful never to send it, but a pageview carries the URL by
     * default and `/jobs?q=…` would hand over every query anyway. This strips
     * it from the URL fields PostHog populates on its own, including the
     * `$initial_*` copies it writes once per browser and would otherwise keep
     * forever.
     */
    before_send: (event) => {
      if (!event) return null;
      const p = event.properties as Record<string, unknown> | undefined;
      if (p) {
        for (const field of ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer"]) {
          if (typeof p[field] === "string") p[field] = stripTrackedParams(p[field] as string);
        }
        const setOnce = p.$set_once as Record<string, unknown> | undefined;
        if (setOnce) {
          for (const field of ["$initial_current_url", "$initial_referrer"]) {
            if (typeof setOnce[field] === "string") {
              setOnce[field] = stripTrackedParams(setOnce[field] as string);
            }
          }
        }
      }
      return event;
    },
  });

  // `track()` and `distinctId()` in lib/analytics.ts read this. Keeping the
  // instance on window means those helpers need no import and therefore no
  // bundle weight on pages that never fire an event.
  (window as unknown as { posthog: typeof posthog }).posthog = posthog;
}
