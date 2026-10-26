"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Bookmark, BookmarkCheck, Check, EyeOff, Share2, Link2 } from "lucide-react";

/**
 * Save, mark applied, hide and share, on the card itself.
 *
 * These were all buried on the job page, which meant triaging a list of results
 * cost a round trip per job. Everything here is a decision you can make from the
 * title alone, so it belongs where the titles are.
 *
 * Sits in `.above-hit`, above the card's stretched link, so pressing a button
 * does not also open the job. Every button stops propagation for the same
 * reason — the stretched link is a sibling ::after, not an ancestor, so a bubbled
 * click would still reach the card.
 *
 * Signed-out users get the buttons and a redirect to sign-in rather than a
 * disabled control: a greyed-out button explains nothing, and saving a job is a
 * perfectly good reason to make an account.
 */
export default function JobCardActions({
  jobId,
  title,
  onHidden,
}: {
  jobId: string;
  title: string;
  /** Lets the list drop the card immediately rather than waiting for a refetch. */
  onHidden?: () => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [applied, setApplied] = useState(false);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ),
    [],
  );

  async function requireUser(): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return true;
    router.push(`/auth/login?next=${encodeURIComponent(`/jobs/${jobId}`)}`);
    return false;
  }

  async function toggleSave(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!(await requireUser())) return;
    setBusy("save");
    const prev = saved;
    setSaved(!prev); // optimistic: the control has to feel instant
    try {
      const { data, error } = await supabase.rpc("toggle_saved_job", { p_job_id: jobId });
      if (error) throw error;
      setSaved(Boolean(data));
    } catch {
      setSaved(prev);
    } finally {
      setBusy(null);
    }
  }

  async function toggleApplied(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!(await requireUser())) return;
    setBusy("applied");
    const next = !applied;
    setApplied(next);
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
      setBusy(null);
    }
  }

  async function hide(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!(await requireUser())) return;
    setBusy("hide");
    try {
      const { error } = await supabase.rpc("toggle_hidden_job", { p_job_id: jobId });
      if (error) throw error;
      onHidden?.();
      router.refresh();
    } catch {
      setBusy(null);
    }
  }

  async function share(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}/jobs/${jobId}`;
    // The native sheet where there is one; clipboard everywhere else. A user
    // cancelling the sheet throws AbortError, which is not a failure.
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {
      /* Clipboard blocked; nothing useful to say. */
    }
  }

  const base =
    "inline-flex min-h-9 items-center gap-1.5 rounded-control border px-3 text-[13px] font-medium transition-colors disabled:opacity-60";

  return (
    <div className="above-hit flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={toggleSave}
        disabled={busy === "save"}
        aria-pressed={saved}
        className={`${base} ${
          saved
            ? "border-action bg-accent-tint text-accent-text"
            : "border-line bg-surface text-fg-2 hover:border-action hover:text-action-text"
        }`}
      >
        {saved ? (
          <BookmarkCheck aria-hidden="true" className="size-4" />
        ) : (
          <Bookmark aria-hidden="true" className="size-4" />
        )}
        {saved ? "Saved" : "Save"}
      </button>

      <button
        type="button"
        onClick={toggleApplied}
        disabled={busy === "applied"}
        aria-pressed={applied}
        className={`${base} ${
          applied
            ? "border-ok bg-ok/10 text-ok"
            : "border-line bg-surface text-fg-2 hover:border-action hover:text-action-text"
        }`}
      >
        <Check aria-hidden="true" className="size-4" />
        {applied ? "Applied" : "Mark applied"}
      </button>

      <button
        type="button"
        onClick={hide}
        disabled={busy === "hide"}
        className={`${base} border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg`}
        title="Stop showing me this job"
      >
        <EyeOff aria-hidden="true" className="size-4" />
        Hide
      </button>

      <button
        type="button"
        onClick={share}
        className={`${base} border-line bg-surface text-fg-2 hover:border-action hover:text-action-text`}
        aria-label={`Share ${title}`}
      >
        {shared ? (
          <Link2 aria-hidden="true" className="size-4" />
        ) : (
          <Share2 aria-hidden="true" className="size-4" />
        )}
        {shared ? "Link copied" : "Share"}
      </button>
    </div>
  );
}
