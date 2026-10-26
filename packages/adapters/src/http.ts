/**
 * Polite HTTP for public ATS feeds.
 *
 * These are unauthenticated, publicly documented job-board endpoints — the same
 * JSON the employer's own careers page fetches. We still behave: identifiable
 * User-Agent, a minimum gap between requests to the same host, bounded
 * concurrency, and exponential backoff that honours `Retry-After`.
 */

/*
 * One bot identity, pointing at the site that is actually doing the fetching.
 * It used to name a domain the project never owned, and three other
 * user-agents in the worker named three more. A fork that sets
 * NEXT_PUBLIC_SITE_URL identifies as itself instead of as the original site.
 */
const SITE = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://www.jobsworm.fun").replace(/\/+$/, "");
export const USER_AGENT = `JobswormBot/1.0 (+${SITE})`;

/** Minimum gap between two requests to the same host. */
export const HOST_DELAY_MS = 350;

/** PLAN.md 4.7: never more than this many in-flight requests overall. */
export const MAX_CONCURRENCY = 5;

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  readonly retriable: boolean;

  constructor(message: string, opts: { status: number; url: string; body?: string; retriable?: boolean }) {
    super(message);
    this.name = "HttpError";
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body ?? "";
    this.retriable = opts.retriable ?? false;
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  method?: "GET" | "POST";
  body?: string;
  /** Skip the per-host delay (used by tests). */
  noDelay?: boolean;
}

const lastHitAt = new Map<string, number>();
const hostQueue = new Map<string, Promise<void>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Serialize the *scheduling* of requests per host so two callers cannot both
 * decide the host is idle. The request itself is not serialized.
 */
async function waitForHostSlot(host: string): Promise<void> {
  const prior = hostQueue.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  hostQueue.set(host, prior.then(() => mine));

  await prior;
  const since = Date.now() - (lastHitAt.get(host) ?? 0);
  if (since < HOST_DELAY_MS) await sleep(HOST_DELAY_MS - since);
  lastHitAt.set(host, Date.now());
  release();
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(secs) && secs >= 0 && secs <= 120) return secs * 1000;
  }
  const base = 800 * 2 ** attempt;
  return base + Math.floor(Math.random() * 300);
}

/** Raw fetch with UA, timeout, per-host politeness and retry/backoff. */
export async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 20_000, retries = 2, headers = {}, signal, method = "GET", body } = opts;
  const host = hostOf(url);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (!opts.noDelay) await waitForHostSlot(host);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
          ...headers,
        },
      });

      if (res.ok) return res;

      const retriable = res.status === 429 || res.status === 408 || res.status >= 500;
      if (retriable && attempt < retries) {
        await sleep(backoffMs(attempt, res.headers.get("retry-after")));
        continue;
      }

      const text = await res.text().catch(() => "");
      throw new HttpError(`HTTP ${res.status} for ${url}`, {
        status: res.status,
        url,
        body: text.slice(0, 500),
        retriable,
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      lastError = err;
      const aborted = signal?.aborted === true;
      if (aborted || attempt >= retries) break;
      await sleep(backoffMs(attempt, null));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new HttpError(`network error for ${url}: ${msg}`, { status: 0, url, retriable: true });
}

/** `fetchWithRetry` + JSON parse, with a typed error on malformed bodies. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await fetchWithRetry(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`invalid JSON from ${url}`, {
      status: res.status,
      url,
      body: text.slice(0, 300),
    });
  }
}

/** `fetchWithRetry` returning the raw body (careers pages, XML feeds). */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await fetchWithRetry(url, { ...opts, headers: { Accept: "text/html,*/*", ...opts.headers } });
  return res.text();
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Test seam: forget the per-host timing state. */
export function resetHostThrottle(): void {
  lastHitAt.clear();
  hostQueue.clear();
}
