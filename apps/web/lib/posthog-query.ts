import "server-only";

/**
 * Reading numbers back out of PostHog.
 *
 * ## Two keys, two jobs, and they are not interchangeable
 *
 * The browser holds the **project token** (`phc_…`), which can write events
 * and nothing else — it is public by design and ships in the page. Reading
 * requires a **personal API key** (`phx_…`) scoped to Query: Read, which is a
 * credential in the ordinary sense and must never reach the client. That is
 * why this module is `server-only`: importing it from a client component is a
 * build error rather than a leak.
 *
 * ## Why the browser never queries this directly
 *
 * The recruiter dashboard shows per-campaign numbers. If the browser could ask
 * PostHog anything, a recruiter could ask about someone else's campaign. The
 * read path therefore goes: this module → an hourly rollup → our own Postgres
 * tables → an RPC that filters by `auth.uid()`. Ownership is enforced in the
 * database, where it can be, rather than in a query string, where it cannot.
 *
 * ## Region
 *
 * EU. Verified: `us.posthog.com` answers 403 for this project. A US host would
 * accept writes and silently drop them, which is the worst failure shape
 * available — numbers that are simply low, with nothing in any log.
 */

const API_HOST = process.env.POSTHOG_API_HOST ?? "https://eu.posthog.com";

export type HogQLResult = {
  columns: string[];
  results: unknown[][];
};

export function posthogQueryConfigured(): boolean {
  return Boolean(process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID);
}

/**
 * Run one HogQL query.
 *
 * No retry, deliberately. This is called once an hour by a cron; a transient
 * failure costs one bucket that the next run re-reads anyway, because every
 * query looks two days back. Retrying inside a 30-second function budget would
 * more likely turn a slow query into a timeout than rescue anything.
 *
 * Returns null rather than throwing on any failure, so a dashboard renders
 * without numbers instead of 500-ing.
 */
export async function hogql(query: string): Promise<HogQLResult | null> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!key || !projectId) return null;

  try {
    const res = await fetch(`${API_HOST}/api/projects/${projectId}/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) {
      // The body carries PostHog's own explanation; the key never appears in
      // it, so this is safe to log and is the only way to debug a 400.
      console.error(`posthog query ${res.status}: ${(await res.text()).slice(0, 400)}`);
      return null;
    }
    const json = (await res.json()) as HogQLResult;
    return Array.isArray(json?.results) ? json : null;
  } catch (err) {
    console.error("posthog query failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
