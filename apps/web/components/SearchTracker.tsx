"use client";

import { useEffect, useRef } from "react";
import { qHash, queryLang, track } from "@/lib/analytics";

/**
 * Counts one search, from the browser.
 *
 * ## Why this is a client component and not a line in the server page
 *
 * "Searches per day" is a number a recruiter is shown and, later, pays
 * attention to. Counting it on the server would count crawlers: `/jobs?q=…`
 * URLs are indexed, shared and re-fetched constantly, and a bot sweeping a
 * hundred of them would look like a hundred job seekers searching. Requiring a
 * browser that runs JavaScript is the cheapest honest filter available.
 *
 * The cost is that people with a tracking blocker are not counted. That is the
 * right direction to be wrong in — the dashboard says so in as many words, and
 * an undercount that we can describe beats an overcount that we cannot.
 *
 * ## Once per query, not once per render
 *
 * The key is the whole search state, so paging from 1 to 2 is a second event
 * (the recruiter's "searches" number counts page-1 events only, see the
 * rollup) while a re-render caused by React is not.
 */
export default function SearchTracker({
  q,
  filterKeys,
  page,
  total,
}: {
  q: string;
  filterKeys: string[];
  page: number;
  total: number;
}) {
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const key = `${q}|${filterKeys.join(",")}|${page}`;
    if (sent.current === key) return;
    sent.current = key;

    let cancelled = false;
    // The hash is async (Web Crypto), so the event is fired in a promise that
    // is allowed to lose a race with an unmount — a search that is navigated
    // away from mid-hash is not worth counting.
    void qHash(q).then((hash) => {
      if (cancelled) return;
      track("search", {
        q_hash: hash,
        q_len: q.trim().length,
        lang: queryLang(q),
        has_filters: filterKeys.length > 0,
        filters: filterKeys,
        page,
        total,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [q, filterKeys, page, total]);

  return null;
}
