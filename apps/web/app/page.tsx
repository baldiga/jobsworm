import { ArrowDown } from "lucide-react";
import HeroSearch from "@/components/HeroSearch";
import { getSiteStats, freshness, compact } from "@/lib/stats";
import SponsoredStrip from "@/components/SponsoredStrip";

/*
 * Home.
 *
 * Deliberately short: a hero that says what this is and proves it with live
 * counters, then the search box. There is no long marketing page — the product
 * is a search engine, and the fastest honest thing it can do is let you search.
 *
 * Cached for five minutes. Nothing here is per-user, and the counters are
 * honest at that resolution.
 */
export const revalidate = 300;

/** "1 job board", "3 job boards". The counts here are live, so they hit 1. */
function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

export default async function HomePage() {
  const stats = await getSiteStats();
  const updated = freshness(stats.newest);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-6">
      {/* ── Hero: the offer on the leading side, the evidence on the trailing ── */}
      <section className="grid grid-cols-1 gap-10 pt-14 pb-10 lg:grid-cols-[1.1fr_minmax(0,1fr)] lg:gap-14 lg:pt-20">
        <div>
          <p
            className="reveal m-0 mb-4 inline-flex items-center rounded-chip bg-accent-tint px-2.5 py-1 text-[13px] font-semibold tracking-wide text-accent-text"
            style={{ animationDelay: "0ms" }}
          >
            Free for job seekers, forever · Organic results can&rsquo;t be bought
          </p>

          <h1 className="reveal" style={{ animationDelay: "60ms" }}>
            Everywhere recruiters post jobs.
            <br />
            <span className="text-action-text">All in one place.</span>
          </h1>

          <p
            className="reveal mt-5 max-w-[46ch] text-lg leading-relaxed text-fg-2"
            style={{ animationDelay: "120ms" }}
          >
            Israeli tech roles pulled straight from the employers, the job boards and the
            Facebook groups where hiring actually happens. Organic results are agency-free,
            deduplicated and never sold; sponsored listings are always labelled.
          </p>

          {stats.ok ? (
            <p
              className="reveal mt-5 flex flex-wrap gap-x-2 gap-y-1 text-[15px] text-fg-2"
              style={{ animationDelay: "180ms" }}
            >
              {[
                stats.atsCount > 0 ? `${stats.atsCount} ${plural(stats.atsCount, "hiring platform")}` : null,
                /*
                 * Pluralised, because this number moves. It read "1 Israeli job
                 * boards" the moment AllJobs and Drushim were withheld and the
                 * count fell to one.
                 */
                stats.boardCount > 0
                  ? `${stats.boardCount} Israeli ${plural(stats.boardCount, "job board")}`
                  : null,
                stats.fbGroups > 0 ? `${stats.fbGroups} Facebook ${plural(stats.fbGroups, "group")}` : null,
                /*
                 * Every number in this line is queried at render time, and that
                 * is the point of the line. A coverage claim is the one thing on
                 * a job board that has to be checkable, so the LinkedIn figure
                 * is the count of LinkedIn posts actually in the index right
                 * now — not the number of posts a scrape once looked at, which
                 * is a much larger number and a much smaller fact.
                 */
                stats.liPosts > 0 ? `${stats.liPosts} LinkedIn ${plural(stats.liPosts, "post")}` : null,
              ]
                .filter(Boolean)
                .map((label, i, arr) => (
                  <span key={label}>
                    <span className="font-semibold text-fg">{label}</span>
                    {i < arr.length - 1 ? <span className="text-line-strong"> · </span> : null}
                  </span>
                ))}
            </p>
          ) : null}
        </div>

        {/*
          Counters. Every one is a live count; see supabase site_stats().

          Rendered ONLY when the numbers are real. They used to fall back to an
          em-dash each, so a single slow query turned the landing page into a
          grid of four blanks under headings like "Open jobs" — which reads as a
          product with nothing in it, the exact opposite of what this block is
          for. A page with no counter panel just looks like a page with no
          counter panel.
        */}
        {stats.ok ? (
          <div className="reveal self-start" style={{ animationDelay: "220ms" }}>
            <div className="grid grid-cols-2 gap-3">
              <Counter label="Open jobs" value={compact(stats.total)} big />
              <Counter label="Applications made" value={compact(stats.applications)} />
              <Counter label="Job seekers" value={compact(stats.seekers)} />
              {updated ? <Counter label="Last updated" value={updated} small wide /> : null}
            </div>
          </div>
        ) : null}
      </section>

      {/* The cue down to the search field. */}
      <p className="m-0 flex items-center justify-center gap-2 pb-6 text-[15px] font-medium text-fg-2">
        No sign-up needed to search
        <ArrowDown aria-hidden="true" className="size-4 shrink-0 animate-bounce" />
      </p>

      {/* ── The search box ─────────────────────────────────────────────────── */}
      <section
        id="search"
        aria-label="Search jobs"
        className="scroll-mt-24 rounded-card border border-line bg-surface p-4 shadow-[0_1px_0_0_rgba(31,27,22,0.04)] sm:p-6"
      >
        {/*
          A server-rendered GET form, NOT the client SearchForm. See
          components/HeroSearch.tsx: the client version reads useSearchParams,
          which removed the whole field from this statically rendered page's
          HTML and left a grey placeholder that people quite reasonably reported
          as a broken search box.
        */}
        <HeroSearch />
      </section>

      {/*
        After the search box, never before it. A visitor who arrived to look
        for work reaches the thing they came for first; the adverts are below
        it. It renders nothing at all while no campaign is live.
      */}
      <SponsoredStrip />

      <div className="h-16" />
    </div>
  );
}

function Counter({
  label,
  value,
  big = false,
  small = false,
  wide = false,
}: {
  label: string;
  value: string;
  big?: boolean;
  small?: boolean;
  /** Fill the row rather than leaving a hole in the two-column grid. */
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-card border border-line bg-surface p-4 ${
        big || wide ? "col-span-2" : ""
      } ${wide ? "flex items-baseline justify-between gap-3" : ""}`}
    >
      <p
        className={`numeral m-0 font-bold leading-none text-fg ${
          big ? "text-[44px]" : small ? "text-[20px]" : "text-[30px]"
        }`}
      >
        {value}
      </p>
      <p className={`m-0 text-[13px] font-medium text-fg-2 ${wide ? "" : "mt-1.5"}`}>{label}</p>
    </div>
  );
}
