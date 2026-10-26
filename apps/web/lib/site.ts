/**
 * The site's own public address. One definition, used everywhere it is needed.
 *
 * ## Why this file exists
 *
 * It used to be defined three times, with three different fallbacks:
 *
 *   layout.tsx   metadataBase   "https://jobswarm.fun"
 *   sitemap.ts   every <loc>    "https://jobswarm.fun"
 *   robots.ts    Sitemap: line  "https://jobswarm.vercel.app"
 *
 * `NEXT_PUBLIC_SITE_URL` is not set in production, so all three fell through
 * to their own guess. After the rename to Jobsworm, and once jobswarm.fun was
 * pointed at www.jobsworm.fun with a permanent redirect on 2026-09-16, that
 * meant the sitemap listed the entire index at addresses that all redirect,
 * and robots.txt sent crawlers to a preview deployment's sitemap instead of
 * either real domain. Three copies of one fact will disagree; here it is once.
 *
 * ## Why www
 *
 * It is the address that actually serves the site. `jobsworm.fun` answers with
 * a 308 to `www.jobsworm.fun`, so a canonical URL without the www would itself
 * be a redirect — the same mistake at one remove.
 *
 * The env var still wins, for preview deployments and local runs. A trailing
 * slash is stripped so `${SITE_URL}/jobs` never becomes `//jobs`.
 *
 * `||`, not `??`. A variable present but blank — an easy thing to leave in the
 * Vercel dashboard — is an empty string, which `??` passes straight through.
 * layout.tsx then runs `new URL("")`, which throws, and every page on the site
 * fails to render. An empty value means "not configured" and gets the default.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://www.jobsworm.fun").replace(
  /\/+$/,
  "",
);
