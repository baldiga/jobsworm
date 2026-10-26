"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Card } from "./ui/Card";
import JobCardActions from "./JobCardActions";

/**
 * A job card that can remove itself.
 *
 * Hiding has to be instant to be worth having: a "not this one" that needs a
 * server round trip and a refetch before the card goes away feels broken, and
 * the user has already moved on. So the card collapses locally the moment the
 * button is pressed, and the row it leaves behind carries an undo — hiding is
 * the one action here that destroys something the user can see, so it needs a
 * way back that does not involve digging through settings.
 *
 * The server write still happens; this only controls what the eye sees while it
 * does. A refresh reconciles either way, because the search query filters out
 * hidden ids.
 */
export default function HideableCard({
  jobId,
  title,
  children,
}: {
  jobId: string;
  title: string;
  children: React.ReactNode;
}) {
  const [hidden, setHidden] = useState(false);

  if (hidden) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-card border border-dashed border-line bg-surface-2/60 px-4 py-3 text-sm text-fg-2">
        <span className="truncate">
          Hidden<span className="hidden sm:inline">: </span>
          <span className="jobtext hidden sm:inline" dir="auto">
            {title}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-control border border-line bg-surface px-3 font-medium text-fg transition-colors hover:border-action hover:text-action-text"
        >
          <Undo2 aria-hidden="true" className="size-4" />
          Undo
        </button>
      </div>
    );
  }

  return (
    <Card interactive className="card-hit group">
      {children}
      {/*
        Actions go BELOW the job, not above it.
        They used to sit at the top behind a bottom border, which put a row of
        Save / Mark applied / Hide / Share between the previous card's last line
        and this card's title — so in a scrolling list they read as belonging to
        the job above them. You cannot decide to save something before you have
        been told what it is.
      */}
      <div className="mt-3 border-t border-line pt-3">
        <JobCardActions jobId={jobId} title={title} onHidden={() => setHidden(true)} />
      </div>
    </Card>
  );
}
