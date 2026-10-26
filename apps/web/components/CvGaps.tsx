"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Chip } from "@/components/ui/Chip";

/**
 * What the jobs you are matching ask for that your profile does not list.
 *
 * ## The framing is the feature
 *
 * "If you have it, add it. If not, this is what those jobs want."
 *
 * Half of these will be skills the person genuinely has and simply did not
 * write down — a ten-second fix that changes their matches immediately, and
 * the most valuable thing this panel does. The other half are real gaps, and
 * the honest thing to do with those is name them and stop. A job board telling
 * somebody what to go and learn has overstepped; describing what the market is
 * asking for has not.
 *
 * So there is one action — "I have this" — and no action at all for the rest.
 *
 * ## Counted from their own matches
 *
 * Not a general "hot skills in Israel" list. These are counted across the
 * reader's own top matches, which means the answer is about the jobs they are
 * actually competing for. A generic list would be advice; this is a
 * description of their own results.
 */

export type CvGap = {
  skill: string;
  jobs_wanting: number;
  example_title: string | null;
  example_company: string | null;
  example_job_id: string | null;
};

export default function CvGaps({ gaps, topN }: { gaps: CvGap[]; topN: number }) {
  const router = useRouter();
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (!gaps.length) return null;

  async function add(skill: string) {
    setAdding(skill);
    setError(null);
    try {
      const res = await fetch("/api/profile/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add: [skill] }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError("Could not add that. Try from My area instead.");
        return;
      }
      setAdded((a) => [...a, skill]);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setAdding(null);
    }
  }

  return (
    <section aria-labelledby="cv-gaps" className="mt-8 rounded-card border border-line bg-surface p-4 sm:p-6">
      <h2 id="cv-gaps" className="mt-0 text-lg">
        What these jobs ask for
      </h2>
      <p className="m-0 mt-1 text-sm text-fg-2">
        Counted across your top {topN} matches.{" "}
        <strong className="font-semibold text-fg">If you have it, add it.</strong> If not, this is
        simply what those jobs want.
      </p>

      <ul className="m-0 mt-4 grid list-none gap-3 p-0">
        {gaps.map((g) => {
          const done = added.includes(g.skill);
          return (
            <li
              key={g.skill}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line pb-3 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <bdi className="font-medium">{g.skill}</bdi>
                <span className="ml-2 text-sm text-fg-2">
                  <span className="numeral">{g.jobs_wanting}</span> of your top {topN}
                </span>
                {g.example_title ? (
                  <span className="mt-0.5 block text-xs text-fg-2">
                    e.g.{" "}
                    {g.example_job_id ? (
                      <Link href={`/jobs/${g.example_job_id}`} className="underline underline-offset-2">
                        <bdi>{g.example_title}</bdi>
                      </Link>
                    ) : (
                      <bdi>{g.example_title}</bdi>
                    )}
                    {g.example_company ? (
                      <>
                        {" at "}
                        <bdi>{g.example_company}</bdi>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </div>

              {done ? (
                <Chip tone="accent">Added</Chip>
              ) : (
                <button
                  type="button"
                  onClick={() => add(g.skill)}
                  disabled={adding !== null}
                  className="shrink-0 text-sm font-medium text-action-text underline underline-offset-4 disabled:opacity-60"
                >
                  {adding === g.skill ? "Adding…" : "I have this"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="m-0 mt-3 text-sm text-warn-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
