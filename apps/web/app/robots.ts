import type { MetadataRoute } from "next";
import { SITE_URL as siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      /*
       * `/hive` is the PostHog proxy: an analytics endpoint, not content.
       *
       * `/recruit` is hidden in its entirety for now: it quotes prices and
       * links to a live checkout, and it is half-built. It goes back in when
       * the area opens. `/admin` does not exist as far as anyone else is
       * concerned.
       */
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/me",
          "/auth/",
          "/api/",
          "/hive/",
          "/admin",
          // The whole recruiter tree, including the pitch page. It is behind
          // an allowlist while it is unfinished, so a crawler following a
          // stale link would only ever find a 404.
          "/recruit",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
