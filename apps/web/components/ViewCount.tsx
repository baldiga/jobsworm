"use client";

import { useEffect, useState } from "react";

/**
 * "Opened N times", on a job card.
 *
 * ## One request per page, not one per card
 *
 * A search page renders up to 26 cards, and 26 fetches for one integer each
 * would be worse than the feature is worth. Every mounted instance drops its
 * id into a module-level queue, and the first one to do so schedules a single
 * flush on the next tick; by then React has mounted them all, so one request
 * carries every id on the page.
 *
 * No provider, no context, nothing for a page to remember to add. A card can
 * be rendered anywhere — search, the home strip, a company page — and it joins
 * whatever batch is forming.
 *
 * ## Why it renders nothing most of the time
 *
 * Below THRESHOLD there is no element at all, not a zero. Roughly nine in ten
 * open listings have no views yet, and a grid of "0 opened" reads as a dead
 * site to a job seeker and as a bad buy to a recruiter. The recruiter
 * dashboard already makes this argument in as many words about blank versus
 * zero, and it applies with more force on a public page.
 *
 * It also means a card below the threshold renders byte-identical HTML to
 * before this existed.
 */

/** Below this, show nothing. A handful of views is noise, not a signal. */
const THRESHOLD = 3;

type Listener = (n: number | null) => void;

const pending = new Set<string>();
const listeners = new Map<string, Set<Listener>>();
const known = new Map<string, number>();
let scheduled = false;

function flush() {
  scheduled = false;
  const ids = [...pending];
  pending.clear();
  if (!ids.length) return;

  fetch(`/api/engagement?ids=${ids.join(",")}`, { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : {}))
    .then((counts: Record<string, number>) => {
      for (const id of ids) {
        /*
         * Absent means zero, not unknown. The RPC returns a row only for open
         * jobs it can see, so an id missing from the answer has no views worth
         * showing — and caching that stops a card re-queueing on every scroll
         * back into view.
         */
        const n = typeof counts[id] === "number" ? counts[id] : 0;
        known.set(id, n);
        listeners.get(id)?.forEach((fn) => fn(n));
      }
    })
    .catch(() => {
      // A counter is decoration. Silence is the correct failure.
    });
}

function request(id: string, fn: Listener): () => void {
  const cached = known.get(id);
  if (cached !== undefined) {
    fn(cached);
  } else {
    let set = listeners.get(id);
    if (!set) listeners.set(id, (set = new Set()));
    set.add(fn);
    pending.add(id);
    if (!scheduled) {
      scheduled = true;
      // A macrotask, not a microtask: microtasks drain before React finishes
      // mounting siblings, which would send one request per card.
      setTimeout(flush, 0);
    }
  }

  return () => {
    listeners.get(id)?.delete(fn);
  };
}

export default function ViewCount({ jobId }: { jobId: string }) {
  const [views, setViews] = useState<number | null>(() => known.get(jobId) ?? null);

  useEffect(() => {
    let live = true;
    const off = request(jobId, (n) => {
      if (live) setViews(n);
    });
    return () => {
      live = false;
      off();
    };
  }, [jobId]);

  if (views === null || views < THRESHOLD) return null;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-2"
      /*
       * "Opened", not "viewed by N people". The number counts VISITS that
       * stayed a second, and one person visiting twice on different days is
       * two. Saying "people" would be a claim the data does not support, on a
       * page where the definition is published.
       */
      title={`Opened ${views} times`}
    >
      <EyeIcon />
      <span className="numeral">{views}</span>
      <span className="sr-only">times opened</span>
    </span>
  );
}

function EyeIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
