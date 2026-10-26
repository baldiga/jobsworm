/**
 * The search route, in one place.
 *
 * It used to be written as a bare "/" in four separate client components. When
 * search moved off the root to make room for the landing page, every one of
 * those would have silently navigated the user out of their own search and onto
 * the marketing page — with no error, because "/" is a perfectly valid route.
 */
export const SEARCH_PATH = "/jobs";

/** Build a search URL from a prepared query string. */
export function searchUrl(params: URLSearchParams | string): string {
  const qs = typeof params === "string" ? params : params.toString();
  return qs ? `${SEARCH_PATH}?${qs}` : SEARCH_PATH;
}
