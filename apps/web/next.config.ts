import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * PostHog, served from our own origin at /hive.
   *
   * Not a nicety. Every content blocker ships a rule for PostHog's own
   * hostnames, so calling them directly loses a large share of visitors — and
   * a *biased* share, skewed towards the technical people who make up this
   * site's audience. The recruiter dashboard sells impression counts; those
   * counts should not depend on who runs uBlock.
   *
   * The EU hosts are not interchangeable with the US ones. This project lives
   * in the EU region: us.posthog.com answers 403 for it, and the US ingestion
   * host would accept events and silently drop them.
   *
   * `/static` and `/array` carry the library and the feature-flag payload and
   * live on the assets host; everything else is ingestion.
   */
  async rewrites() {
    return [
      {
        source: "/hive/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      { source: "/hive/array/:path*", destination: "https://eu-assets.i.posthog.com/array/:path*" },
      { source: "/hive/:path*", destination: "https://eu.i.posthog.com/:path*" },
    ];
  },
  // PostHog's API is sensitive to a trailing slash being added by a redirect.
  skipTrailingSlashRedirect: true,

  async redirects() {
    return [
      /*
       * Search used to live at "/" and moved to "/jobs" when the landing page
       * took the root. Any indexed or shared URL carrying a query, a filter or
       * a page number would otherwise land on the marketing page with its
       * parameters silently ignored.
       *
       * `has` keeps this scoped to URLs that actually carry search state, so a
       * plain visit to "/" still reaches the landing page. Each of these is a
       * separate rule because `has` entries are AND-ed, not OR-ed.
       */
      ...["q", "region", "function", "seniority", "remote", "salary", "days", "page"].map(
        (key) => ({
          source: "/",
          has: [{ type: "query" as const, key }],
          destination: "/jobs",
          permanent: true,
        }),
      ),
    ];
  },
};

export default nextConfig;
