import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import FilterBar from "@/components/FilterBar";
import SearchTracker from "@/components/SearchTracker";
import JobCard from "@/components/JobCard";
import SponsoredSlots from "@/components/SponsoredSlots";
import SearchForm from "@/components/SearchForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { searchUrl } from "@/lib/routes";
import { createReadClient, supabaseConfigured } from "@/lib/supabase";
import type { JobRow } from "@/lib/types";
import {
  expandQuery,
  queryHebrewVariants,
  relatedTerms,
  toWebsearchQuery,
} from "@jobsworm/core";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search jobs",
  description:
    "Search every open Israeli tech job in one index. Filter by region, seniority, remote work and salary.",
};

/*
 * Twenty, not twenty-five.
 *
 * Six sponsored cards now share the page — three above the results and three
 * below them — and at twenty-five organic rows the page had grown long enough
 * that the bottom block was well past where anybody scrolls. Twenty keeps the
 * second block reachable and the page a sensible length on a phone.
 */
const PAGE_SIZE = 20;

/*
 * Three at the top, three at the bottom.
 *
 * The top three are the best matches for what was actually typed. The bottom
 * three are the next best, shown after the organic results rather than stacked
 * with the others: six adverts in a row above the first real result would be a
 * different kind of site.
 */
const SPONSORED_PER_PAGE = 6;
const SPONSORED_TOP = 3;

type SearchParams = Record<string, string | string[] | undefined>;

function asArray(v: string | string[] | undefined): string[] | undefined {
  if (!v) return undefined;
  const list = Array.isArray(v) ? v : [v];
  return list.length ? list : undefined;
}

function buildFilters(sp: SearchParams) {
  const filters: Record<string, unknown> = {};
  const regions = asArray(sp.region);
  const functions = asArray(sp.function);
  const seniority = asArray(sp.seniority);
  const remote = asArray(sp.remote);
  if (regions) filters.regions = regions;
  if (functions) filters.functions = functions;
  if (seniority) filters.seniority = seniority;
  if (remote) filters.remote = remote;
  if (sp.salary === "1") filters.has_salary = true;
  if (sp.days) filters.posted_within_days = Number(sp.days);
  const sources = asArray(sp.source);
  if (sources) filters.sources = sources;

  /*
   * The barrier filters (0040). Each maps to a predicate that already had the
   * data behind it and no way to ask.
   */
  if (sp.junior === "1") filters.junior_friendly = true;
  if (sp.nodegree === "1") filters.no_degree = true;
  if (sp.hebrew === "1") filters.hebrew_optional = true;
  const years = Number(sp.years);
  if (Number.isFinite(years) && years > 0) filters.years_max = Math.min(30, Math.trunc(years));

  return filters;
}

/**
 * Words to exclude, folded into the query as websearch `-term`.
 *
 * `websearch_to_tsquery` already understands `-word` for NOT and `"phrase"` for
 * an exact phrase, so advanced search does not need its own query language or
 * its own SQL — it just writes the operators the parser already speaks.
 */
function withExclusions(query: string, raw: string | undefined): string {
  if (!raw) return query;
  const terms = raw
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .slice(0, 6);
  if (!terms.length) return query;
  return terms.reduce((q, t) => `${q} -${t}`, query);
}

/** One retry on a statement timeout, then give up and let the caller degrade. */
async function withRetry<T extends { error: { message: string } | null }>(
  run: () => PromiseLike<T>,
): Promise<T> {
  const first = await run();
  if (!first.error) return first;
  if (!/statement timeout|canceling statement/i.test(first.error.message)) return first;
  await new Promise((r) => setTimeout(r, 400));
  return run();
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const filters = buildFilters(sp);
  const hasQuery = Boolean(q) || Object.keys(filters).length > 0;

  /*
   * The same job is posted as "Marketing Manager" by one employer and
   * "מנהל שיווק" by the next, so searching one word shows roughly half the
   * market. The query is widened to its equivalents in the other language
   * before it reaches the database.
   *
   * Only exact equivalents go into the main query. Neighbouring roles are
   * fetched separately and shown in their own labelled block, because
   * "marketing" returning SEO jobs inside the main count would misstate what
   * was actually found.
   */
  const alsoSearched = q ? expandQuery(q) : [];

  /*
   * Hebrew inflects the job title itself, so one role is spelled four ways
   * before any synonym is involved: מפתח / מפתחת / מפתחים / מפתחות. The index
   * stores what the employer wrote, and most employers write the masculine
   * singular — so a woman searching מפתחת got nothing, for a query that is
   * simply her own job title.
   *
   * These go into the main query rather than the near-match block, because
   * they are not near matches. They are the same word.
   */
  const heForms = q ? queryHebrewVariants(q) : [];
  const widened = [...alsoSearched, ...heForms.filter((t) => !alsoSearched.includes(t))];

  const excludeRaw = typeof sp.exclude === "string" ? sp.exclude : undefined;
  const searchQ = q ? withExclusions(toWebsearchQuery(q, widened), excludeRaw) : null;

  let jobs: JobRow[] = [];
  let total = 0;
  let facets = {};
  let nearJobs: JobRow[] = [];
  let nearTerms: string[] = [];
  let sponsored: JobRow[] = [];
  let dbError: string | null = null;

  if (supabaseConfigured) {
    const supabase = await createReadClient();

    /*
     * The three calls are issued together but they are NOT equally important.
     * Results are the page; the count and the facet counts are decoration. When
     * the database is briefly overloaded, losing a facet count should cost a
     * filter chip, not the whole screen.
     *
     * A statement timeout also gets one retry. It usually means the instance
     * was momentarily busy rather than the query being impossible, and a second
     * attempt a moment later normally succeeds.
     */
    const [jobsRes, countRes, facetRes, sponsoredRes] = await Promise.all([
      withRetry(() =>
        supabase.rpc("search_jobs", {
          q: searchQ,
          p_filters: filters,
          p_limit: PAGE_SIZE,
          p_offset: (page - 1) * PAGE_SIZE,
        }),
      ),
      withRetry(() => supabase.rpc("search_jobs_count", { q: searchQ, p_filters: filters })),
      withRetry(() => supabase.rpc("search_facets", { q: searchQ, p_filters: filters })),
      /*
       * The paid surface. Page 1 only, and never retried: an advert that was
       * slow once should not make a search page slower a second time. It joins
       * the same Promise.all so it costs no extra wall-clock.
       */
      page === 1
        ? supabase.rpc("sponsored_jobs", {
            q: searchQ,
            p_filters: filters,
            p_limit: SPONSORED_PER_PAGE,
          })
        : Promise.resolve({ data: null, error: null }),
    ]);

    /*
     * Never show a Postgres message to a job seeker. "canceling statement due
     * to statement timeout" tells them nothing they can act on and reads as a
     * broken site; it belongs in the server log, which is where it now goes.
     */
    if (jobsRes.error) {
      console.error("[search] search_jobs failed:", jobsRes.error.message);
      dbError = "busy";
    }
    // These two only degrade the page, so they are logged and not surfaced.
    if (countRes.error) console.error("[search] count failed:", countRes.error.message);
    if (facetRes.error) console.error("[search] facets failed:", facetRes.error.message);
    jobs = (jobsRes.data as JobRow[] | null) ?? [];
    total = (countRes.data as number | null) ?? 0;
    facets = (facetRes.data as object | null) ?? {};

    /*
     * Sponsored cards, and the organic list with those same jobs removed.
     *
     * An employer whose listing already ranks organically still gets the
     * labelled slot they paid for — but showing the identical card twice on
     * one page reads as a bug, and quietly makes their purchase look like a
     * ranking boost, which is the one thing this whole design says it is not.
     *
     * `total` is deliberately NOT adjusted. It counts what matched the search,
     * and paid placement does not change that. The aria-live announcement
     * reads from it and must stay honest.
     */
    if (sponsoredRes.error) {
      console.error("[search] sponsored_jobs failed:", sponsoredRes.error.message);
    }
    sponsored = (sponsoredRes.data as JobRow[] | null) ?? [];
    if (sponsored.length) {
      const shown = new Set(sponsored.map((j) => j.id));
      jobs = jobs.filter((j) => !shown.has(j.id));
    }

    /*
     * Near matches, on the first page only and only when the exact results do
     * not already fill it. Running this on page 5 of 200 results would be
     * noise, and paying for a second query to append suggestions under a full
     * page of real hits helps nobody.
     */
    if (q && page === 1 && jobs.length < PAGE_SIZE) {
      nearTerms = relatedTerms(q);
      if (nearTerms.length) {
        const nearRes = await supabase.rpc("search_jobs", {
          q: toWebsearchQuery(nearTerms[0], nearTerms.slice(1)),
          p_filters: filters,
          p_limit: 12,
          p_offset: 0,
        });
        const seen = new Set(jobs.map((j) => j.id));
        nearJobs = ((nearRes.data as JobRow[] | null) ?? [])
          .filter((j) => !seen.has(j.id))
          .slice(0, 6);
      }
    }
  } else {
    dbError = "Search is not configured";
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6">
      {/*
        The page keeps its h1 whether or not a query is present. It used to be
        rendered only on the empty state, so the most-used screen in the app had
        no h1 at all and its headings began at h3.
      */}
      <h1 className="mb-4 text-[clamp(1.75rem,4vw,2.5rem)]">
        {q ? (
          <>
            Jobs matching{" "}
            <span className="jobtext text-action-text" dir="auto">
              {q}
            </span>
          </>
        ) : (
          "Israeli tech jobs"
        )}
      </h1>

      <div className="mb-6">
        <Suspense fallback={<div className="min-h-[52px] rounded-control bg-surface-2" />}>
          <SearchForm autoFocus={!hasQuery} />
        </Suspense>
      </div>

      {dbError ? (
        <p className="rounded-card border border-line bg-warn-tint p-4 text-warn-text">
          Search is busy right now and this page may be incomplete. Reloading usually fixes it.
        </p>
      ) : null}

      {/*
        Filters are a sticky capsule row above the results now, not a sidebar.
        In a column they scrolled out of reach exactly when a reader decided to
        narrow, which meant scrolling back up to change one thing.
      */}
      <Suspense fallback={null}>
        <FilterBar facets={facets} />
      </Suspense>

      <div>
        <section>
          {/*
            Counted in the browser, not here: these URLs are indexed and
            crawled, and a bot sweep would otherwise read as a burst of people
            searching. See components/SearchTracker.tsx.
          */}
          {hasQuery ? (
            <SearchTracker
              q={q ?? ""}
              filterKeys={Object.keys(filters)}
              page={page}
              total={total}
            />
          ) : null}
          {/*
            Clicking a filter swaps the entire result list with no visible
            transition, which a screen reader would otherwise never announce.
          */}
          <div
            aria-live="polite"
            aria-atomic="true"
            className="mb-4 border-b border-line pb-2 text-sm text-fg-2"
          >
            {total > 0 ? (
              <>
                <span className="numeral font-bold text-fg">{total.toLocaleString("en-US")}</span>{" "}
                open {total === 1 ? "job" : "jobs"}
              </>
            ) : hasQuery ? (
              "No results"
            ) : (
              "Loading jobs"
            )}
            {/*
              Say when the query was widened. A search that silently returns
              Hebrew results for an English word looks like a bug until you
              explain it.
            */}
            {widened.length ? (
              <>
                {" · also searching "}
                {widened.slice(0, 4).map((t, i) => (
                  <span key={t}>
                    {i > 0 ? ", " : ""}
                    <bdi className="jobtext font-medium text-fg">{t}</bdi>
                  </span>
                ))}
              </>
            ) : null}
          </div>

          <SponsoredSlots jobs={sponsored.slice(0, SPONSORED_TOP)} />

          {jobs.length ? (
            <ol className="m-0 grid list-none gap-3 p-0">
              {jobs.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} />
                </li>
              ))}
            </ol>
          ) : hasQuery ? (
            <EmptyState title={q ? `Nothing found for “${q}”` : "Nothing found"}>
              <p className="m-0">Try a broader term, or remove some of the filters.</p>
            </EmptyState>
          ) : (
            <EmptyState
              title="Jobs are on the way"
              action={<ButtonLink href="/">What is Jobsworm?</ButtonLink>}
            >
              <p className="m-0">
                We are crawling the careers pages of hundreds of Israeli tech companies.
              </p>
            </EmptyState>
          )}

          {/*
            The second block, after the results rather than beside them.

            Only rendered when there is something to put in it AND there were
            organic results to sit under — a page showing "nothing found" and
            then three adverts would read as though the adverts were the
            answer.
          */}
          {jobs.length ? <SponsoredSlots jobs={sponsored.slice(SPONSORED_TOP)} position="below" /> : null}

          {totalPages > 1 ? (
            <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
              <PageLink sp={sp} page={page - 1} disabled={page <= 1}>
                Previous
              </PageLink>
              <span className="px-2 text-sm text-fg-2">
                Page <span className="numeral">{page}</span> of{" "}
                <span className="numeral">{totalPages}</span>
              </span>
              <PageLink sp={sp} page={page + 1} disabled={page >= totalPages}>
                Next
              </PageLink>
            </nav>
          ) : null}

          {/*
            Near matches are kept visually and semantically separate from the
            result list above, and excluded from the count, because they are a
            different question: not "jobs matching what you typed" but "jobs in
            the same field". Folding them in would inflate the number.
          */}
          {nearJobs.length ? (
            <section aria-labelledby="near-matches" className="mt-10 border-t border-line pt-6">
              <h2 id="near-matches" className="mb-1 text-xl">
                Near matches
              </h2>
              <p className="m-0 mb-4 text-sm text-fg-2">
                Not what you searched for, but in the same field
                {nearTerms.length ? (
                  <>
                    {" — "}
                    {nearTerms.slice(0, 5).map((t, i) => (
                      <span key={t}>
                        {i > 0 ? ", " : ""}
                        <bdi className="jobtext">{t}</bdi>
                      </span>
                    ))}
                  </>
                ) : null}
                .
              </p>
              <ol className="m-0 grid list-none gap-3 p-0">
                {nearJobs.map((job) => (
                  <li key={job.id}>
                    <JobCard job={job} />
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function PageLink({
  sp,
  page,
  disabled,
  children,
}: {
  sp: SearchParams;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    // Was text-line-strong at 1.9:1. Disabled controls are exempt from the
    // contrast minimum, but "exempt" is not the same as "illegible".
    return (
      <span className="rounded-control px-3 py-2 text-sm text-fg-2 opacity-45">{children}</span>
    );
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "page" || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) params.append(k, one);
  }
  params.set("page", String(page));
  return (
    <Link
      href={searchUrl(params)}
      className="min-h-11 rounded-control border border-line bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-line-strong"
    >
      {children}
    </Link>
  );
}
