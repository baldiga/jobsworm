"use client";

import { useEffect, useState } from "react";
import { WormMark } from "./ui/Worm";

/**
 * The wait while a CV is parsed.
 *
 * Parsing takes a few seconds and the work is invisible, so a spinner would
 * carry no information: it looks the same whether the file is being read or the
 * request has stalled. This names the step it is on instead, which both fills
 * the time and tells the user what we actually do with the file — useful, given
 * the next thing we ask for is an account.
 *
 * The steps are honest about the real pipeline: extract text, match against the
 * skill dictionary, classify the field, rank open jobs. They advance on a timer
 * rather than from real progress, because the server does the whole parse in
 * one request and has nothing to stream back. The last step holds until the
 * request actually returns, so the animation never claims to be finished first.
 */
const STEPS = [
  "Reading the file",
  "Pulling out skills",
  "Working out your field",
  "Ranking open jobs",
];

export default function CvAnalyzing({ done = false }: { done?: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => {
      // Hold on the last step rather than looping: a progress display that
      // restarts reads as a crash.
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }, 1400);
    return () => clearInterval(t);
  }, [done]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-card border border-line bg-surface p-5"
    >
      {/* The worm burrows through soil while it works. */}
      <div className="burrow-track relative h-12 w-full overflow-hidden rounded-card">
        <div className="burrow-worm text-action">
          <span className="burrow-puff absolute -left-2 top-1/2 block size-4 -translate-y-1/2 rounded-full bg-fg/15" />
          <WormMark size={38} />
        </div>
      </div>

      <ol className="m-0 mt-4 grid list-none gap-1.5 p-0">
        {STEPS.map((label, i) => {
          const state = i < step ? "done" : i === step ? "live" : "todo";
          return (
            <li
              key={label}
              className={`flex items-center gap-2.5 text-sm ${
                state === "todo" ? "text-fg-2/45" : "text-fg-2"
              } ${state === "live" ? "step-live font-medium text-fg" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`inline-block size-2 shrink-0 rounded-full ${
                  state === "done"
                    ? "bg-action"
                    : state === "live"
                      ? "bg-action animate-pulse"
                      : "bg-line-strong/40"
                }`}
              />
              {label}
            </li>
          );
        })}
      </ol>

      <p className="m-0 mt-4 text-xs text-fg-2">
        The file is read once and stays in a private bucket. We keep the skills, not the CV.
      </p>
    </div>
  );
}
