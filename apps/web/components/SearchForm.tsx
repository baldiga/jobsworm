"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Search, FileUser } from "lucide-react";
import { searchUrl } from "@/lib/routes";
import { ChipToggle } from "./ui/Chip";
import { WormSpinner } from "./ui/WormSpinner";

const EXAMPLES = ["Backend", "DevOps", "Product", "Data Engineer", "QA", "Frontend"];

export default function SearchForm({
  autoFocus = false,
  size = "md",
}: {
  autoFocus?: boolean;
  /** "lg" is the home-page hero field. */
  size?: "md" | "lg";
}) {
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  /*
   * A same-route navigation with new search params does not re-trigger
   * loading.tsx, so without this the page sits on the previous results with no
   * sign anything is happening. useTransition tells us exactly when the new
   * server render is in flight.
   */
  const [pending, startTransition] = useTransition();

  /*
   * Keep the field in sync when navigation changes ?q= (back button, example
   * chips) by adjusting state during render rather than in an effect. Setting
   * state inside an effect renders once with the stale value and again with the
   * fresh one, so the previous query visibly flashes on every back-navigation.
   */
  const queryParam = params.get("q") ?? "";
  const [lastQuery, setLastQuery] = useState(queryParam);
  const [value, setValue] = useState(queryParam);
  if (queryParam !== lastQuery) {
    setLastQuery(queryParam);
    setValue(queryParam);
  }

  function submit(next: string) {
    const sp = new URLSearchParams(params.toString());
    const trimmed = next.trim();
    if (trimmed) sp.set("q", trimmed);
    else sp.delete("q");
    sp.delete("page");
    startTransition(() => router.push(searchUrl(sp)));
  }

  const tall = size === "lg";

  return (
    <div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className={`flex flex-col gap-2 sm:flex-row ${
          tall ? "sm:gap-2.5" : ""
        }`}
      >
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-fg-2"
          />
          <label htmlFor="q" className="sr-only">
            Search jobs by title, technology or company
          </label>
          <input
            ref={inputRef}
            id="q"
            name="q"
            type="search"
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Job title, technology or company"
            className={`w-full rounded-control border border-line-strong bg-surface ps-12 pe-4 text-base text-fg placeholder:text-fg-2 focus:border-action ${
              tall ? "min-h-[60px] py-4 sm:text-lg" : "min-h-[52px] py-3"
            }`}
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-control bg-action px-6 font-medium text-on-action transition-colors hover:bg-action-hover sm:flex-none ${
              tall ? "min-h-[60px]" : "min-h-[52px]"
            }`}
          >
            {pending ? <WormSpinner size={20} label="Searching" /> : null}
            {pending ? "Searching" : "Search"}
          </button>

          {/*
            Second entry point to CV matching. It is the feature people are
            least likely to discover from a nav item, and it belongs next to the
            thing it is an alternative to: search by words, or search by CV.
          */}
          <Link
            href="/match"
            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-5 font-medium text-fg transition-colors hover:border-action hover:text-action-text sm:flex-none ${
              tall ? "min-h-[60px]" : "min-h-[52px]"
            }`}
          >
            <FileUser aria-hidden="true" className="size-[18px] shrink-0" />
            Find by CV
          </Link>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-2">Try:</span>
        {EXAMPLES.map((ex) => (
          <ChipToggle
            key={ex}
            selected={value === ex}
            onClick={() => {
              setValue(ex);
              submit(ex);
            }}
          >
            {ex}
          </ChipToggle>
        ))}
      </div>
    </div>
  );
}
