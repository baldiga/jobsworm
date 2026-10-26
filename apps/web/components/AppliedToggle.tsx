"use client";

import { useState } from "react";
import { Check } from "lucide-react";

/**
 * Self-reported application state. The application itself happens on the
 * employer's site, so the user is the only one who can tell us it happened.
 */
export default function AppliedToggle({
  jobId,
  applied: initial,
  compact = false,
}: {
  jobId: string;
  applied: boolean;
  compact?: boolean;
}) {
  const [applied, setApplied] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !applied;
    setApplied(next); // optimistic: the control must feel instant
    setBusy(true);
    try {
      const res = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, applied: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.tracked === false) setApplied(!next);
    } catch {
      setApplied(!next);
    } finally {
      setBusy(false);
    }
  }

  const label = applied ? "Applied" : compact ? "Mark applied" : "Mark as applied";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={applied}
      className={`inline-flex items-center gap-1.5 rounded-chip border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-60 ${
        applied
          ? "border-ok bg-ok/10 font-medium text-ok"
          : "border-line-strong text-fg-2 hover:border-action hover:text-action-text"
      }`}
    >
      {applied ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      {label}
    </button>
  );
}
