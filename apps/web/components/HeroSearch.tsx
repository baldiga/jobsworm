import Link from "next/link";
import { Search, FileUser } from "lucide-react";
import { SEARCH_PATH } from "@/lib/routes";
import SearchPending from "./SearchPending";

const EXAMPLES = ["Backend", "DevOps", "Product", "Data Engineer", "QA", "Frontend"];

/**
 * The home-page search box. A plain GET form, and a server component.
 *
 * WHY THIS EXISTS SEPARATELY FROM SearchForm: SearchForm is a client component
 * that calls `useSearchParams()`, which opts its subtree out of static
 * prerendering. The home page is statically rendered (`revalidate = 300`), so
 * the shipped HTML contained no search field at all — just the Suspense
 * fallback, a grey rounded box that looks exactly like a search bar and does
 * nothing until React hydrates. Users reported "the search doesn't work", and
 * they were right: for the first moments of the page, and forever if hydration
 * failed, there was no input to type into.
 *
 * The home page has no query parameters to read, so it never needed the hook.
 * A native `<form action="/jobs" method="get">` is in the HTML immediately,
 * submits without JavaScript, and survives a hydration failure. The example
 * chips are links for the same reason.
 *
 * SearchForm stays as it is on /jobs, where the page is dynamic and the form
 * genuinely has to merge the query with the filters already applied.
 */
export default function HeroSearch() {
  return (
    <div>
      <form action={SEARCH_PATH} method="get" className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-fg-2"
          />
          <label htmlFor="q" className="sr-only">
            Search jobs by title, technology or company
          </label>
          <input
            id="q"
            name="q"
            type="search"
            placeholder="Job title, technology or company"
            className="min-h-[60px] w-full rounded-control border border-line-strong bg-surface ps-12 pe-4 py-4 text-base text-fg placeholder:text-fg-2 focus:border-action sm:text-lg"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex min-h-[60px] flex-1 items-center justify-center gap-2 rounded-control bg-action px-6 font-medium text-on-action transition-colors hover:bg-action-hover sm:flex-none"
          >
            Search
          </button>

          <Link
            href="/match"
            className="inline-flex min-h-[60px] flex-1 items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-5 font-medium text-fg transition-colors hover:border-action hover:text-action-text sm:flex-none"
          >
            <FileUser aria-hidden="true" className="size-[18px] shrink-0" />
            Find by CV
          </Link>
        </div>
      </form>

      {/* Links, not buttons: they work in the static HTML like the form does. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-2">Try:</span>
        {EXAMPLES.map((ex) => (
          <Link
            key={ex}
            href={`${SEARCH_PATH}?q=${encodeURIComponent(ex)}`}
            className="inline-flex min-h-9 items-center rounded-chip border border-line bg-surface px-2.5 py-0.5 text-[13px] leading-6 text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
          >
            {ex}
          </Link>
        ))}
      </div>

      {/* Progressive enhancement only: the form already works without it. */}
      <SearchPending />
    </div>
  );
}
