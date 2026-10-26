"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The strip between the header and the page: recruiters can post for free.
 *
 * ## Why it is a client component
 *
 * Only so it can read the pathname. The alternative, `headers()` in the server
 * layout, is a dynamic API — reading it in the root layout opts EVERY route out
 * of static rendering, which is exactly how the footer took the static route
 * count from nine to four earlier today. A client component costs a few hundred
 * bytes and leaves the nine intact.
 *
 * ## Home page only
 *
 * An exact match on "/", not a prefix — every other route is somewhere the
 * reader went on purpose, and a strip above the search results or a job
 * description interrupts the thing they came to do. The home page is the one
 * place where a visitor has not yet said what they want, so it is the one
 * place this costs nothing to read past.
 *
 * The recruiter pages are covered by the same rule rather than needing their
 * own: an announcement pointing at /recruit, rendered above a hero making the
 * same offer in larger type, would just be the offer twice.
 */
export default function AnnounceBar() {
  const pathname = usePathname();
  if (pathname !== "/") return null;

  return (
    <aside
      aria-label="Announcement"
      className="border-b border-announce-text/15 bg-announce text-announce-text"
    >
      {/*
        Same 1120px measure and side padding as the header above it, so the
        text starts on the same vertical line as the wordmark rather than
        floating in the middle of a full-bleed band.

        `text-center sm:text-start` because at 390px the sentence wraps to two
        lines and a ragged left edge under a centred first line reads as broken;
        centred, a two-line wrap looks intentional.
      */}
      <p className="mx-auto m-0 w-full max-w-[1120px] px-4 py-2 text-center text-[13px] font-medium sm:px-6 sm:text-start sm:text-sm">
        {/*
          "New!" carries the whole reason this is loud, so it is the one bold
          thing in the line. Not a separate chip: a pill inside a coloured strip
          is two backgrounds fighting in 24 pixels of height.
        */}
        <span className="font-bold">New!</span> Recruiters, post your jobs for free{" "}
        {/*
          The word the user reads as the action gets the underline. A bare
          "here" in the same brown as the sentence is invisible as a link, and
          `underline-offset` keeps the rule off the descender of the r.
        */}
        <Link
          href="/recruit"
          className="font-bold underline decoration-2 underline-offset-2 transition-opacity hover:opacity-70 focus-visible:opacity-70"
        >
          here
        </Link>
      </p>
    </aside>
  );
}
