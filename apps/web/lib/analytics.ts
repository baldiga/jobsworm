/**
 * Product analytics, and the rules about what may leave the browser.
 *
 * Two sinks run side by side and they are not interchangeable:
 *
 *   /api/events  → the `events` table. `site_stats` counts `apply_click` rows
 *                  out of it for the home page, and `job_view` rows drive the
 *                  open-count printed on each job card, so it must keep
 *                  working exactly as it does today.
 *   PostHog      → the numbers a paying recruiter is shown.
 *
 * This block used to say PostHog was "the only place where a stranger sees
 * anything derived from what visitors did on the site". That stopped being
 * true when the view counter shipped, and the sentence is corrected rather
 * than quietly left: it was the clearest statement of a boundary the site had,
 * and a stale privacy claim is worse than none because people act on it.
 *
 * The boundary that replaced it is narrower and still real. What a stranger
 * sees is one integer per listing, counting VISITS, built only from this
 * anonymous stream — never from `job_views` or `saved_jobs`, which are the
 * signed-in reader's own records. That separation is the reason no consent
 * text had to change, and it is the line to hold if anyone proposes publishing
 * a save count next.
 *
 * ## What is never sent
 *
 * No email, no user id, no CV, nothing off a profile. `identify()` is never
 * called anywhere in this codebase, which is what keeps every event anonymous
 * — PostHog is initialised with `person_profiles: "identified_only"`, so
 * without an identify call no person record is ever created.
 *
 * And the search query itself never leaves as text. `search` carries a hash
 * and a length instead. The reasoning is specific rather than squeamish: the
 * recruiter dashboard needs "how many searches a day", never "what people
 * typed", and PostHog is the store those recruiter numbers come out of. Google
 * Analytics already receives the URL with `?q=` on it and is disclosed as
 * doing so; that is the owner's own analytics and a different question.
 */

/** Every event this app may emit. PostHog will accept anything; we will not. */
export type EventName =
  | "search"
  | "sponsored_impression"
  | "sponsored_job_view"
  | "apply_click";

type Props = Record<string, string | number | boolean | null | undefined | string[]>;

/**
 * Query parameters that carry what a person typed or chose.
 *
 * Stripped from every URL PostHog would otherwise capture — `$current_url`,
 * `$referrer`, and the `$initial_*` copies it sets once per browser. Without
 * this the raw query arrives anyway, on the pageview, and the care taken over
 * the `search` event would be decorative.
 */
const SENSITIVE_PARAMS = ["q", "exclude"];

export function stripTrackedParams(url: string): string {
  if (!url) return url;
  try {
    const u = new URL(url);
    let touched = false;
    for (const key of SENSITIVE_PARAMS) {
      if (u.searchParams.has(key)) {
        u.searchParams.delete(key);
        touched = true;
      }
    }
    return touched ? u.toString() : url;
  } catch {
    // Not a URL we can parse — send nothing rather than guess.
    return "";
  }
}

/**
 * A stable, one-way fingerprint of a query.
 *
 * Enough to count distinct searches and to spot a query that suddenly spikes;
 * not enough to read back what was typed. Truncated to 16 hex characters
 * because the whole digest is 64 and the extra 48 buy nothing here.
 *
 * `crypto.subtle` exists in both the browser and the Node runtime this app
 * builds for, so one implementation covers client and server.
 */
export async function qHash(q: string): Promise<string> {
  const normalised = q.trim().toLowerCase();
  if (!normalised) return "";
  const bytes = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** Roughly what script a query is in, for reading the numbers later. */
export function queryLang(q: string): "he" | "en" | "mixed" | "other" {
  const he = /[֐-׿]/.test(q);
  const en = /[A-Za-z]/.test(q);
  if (he && en) return "mixed";
  if (he) return "he";
  if (en) return "en";
  return "other";
}

export function analyticsConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

/**
 * Send one event, and never let analytics break the thing it is measuring.
 *
 * Fire-and-forget by construction: no await, no promise returned, every path
 * swallowed. The apply button in particular must open the employer's page
 * whether or not this works.
 */
export function track(name: EventName, props: Props = {}): void {
  if (typeof window === "undefined") return;
  try {
    const posthog = (window as unknown as { posthog?: { capture?: (n: string, p?: Props) => void } })
      .posthog;
    posthog?.capture?.(name, props);
  } catch {
    // Blocked, not loaded, or failing. Not our problem to solve here.
  }
}

/** The distinct id PostHog is using, when it loaded at all. */
export function distinctId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const posthog = (window as unknown as { posthog?: { get_distinct_id?: () => string } }).posthog;
    return posthog?.get_distinct_id?.() ?? null;
  } catch {
    return null;
  }
}
