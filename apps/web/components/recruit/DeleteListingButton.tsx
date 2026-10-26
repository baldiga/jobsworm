"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Deleting a listing from the list, without opening it first.
 *
 * ## Why it is here and not only on the listing's own page
 *
 * There was already a way to close a listing, on the page for that one
 * listing. That is the wrong place for the common case: somebody with four
 * drafts wants to clear two of them, and making them open each one, scroll,
 * confirm and navigate back is three steps too many for a decision they have
 * already made.
 *
 * ## "Delete" takes it off the site; it does not destroy the record
 *
 * `withdraw_my_campaign` cancels a listing that was never paid for and ends
 * one that ran, and either way the job stops being public at once — which is
 * what the word means to the person clicking it. What it does not do is delete
 * the row. A campaign is a financial record even when nothing was paid, and a
 * listing that ran has impressions attached; hard-deleting would remove the
 * audit trail to save a few bytes.
 *
 * The row is then hidden from the list, so the button visibly does what it
 * says. It stays reachable at its own URL.
 *
 * ## Paid listings get it too, with different words
 *
 * They used to be excluded, so that ending one went through a person. That was
 * backwards: the commonest reason to take a listing down is that the role was
 * filled, and the paid listings are the most prominent ones on the site — the
 * worst ones to leave up after the job is gone.
 *
 * So a paid listing can be withdrawn, and the confirmation says plainly what
 * happens to the money first: it stops now, and nothing is refunded — not the
 * days served, not the days remaining. Saying it before the click is the whole
 * point; saying it afterwards would be an apology.
 *
 * The confirmation is a second click rather than a dialog for an unpaid draft.
 * A paid one gets the sentence as well, because there the click costs
 * something.
 */
export default function DeleteListingButton({
  campaignId,
  title,
  paid = false,
}: {
  campaignId: string;
  title: string;
  /** Paid and running: the confirmation has to mention the money. */
  paid?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recruit/campaigns/${campaignId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not delete it.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <span className="text-xs text-warn-text">
        {error}{" "}
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(false);
          }}
          className="underline underline-offset-2"
        >
          Dismiss
        </button>
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-control px-2 py-1 text-xs text-fg-2 underline underline-offset-2 hover:text-warn-text"
        /* The title is in the accessible name: a screen reader hitting six
           identical "Delete" buttons in a table learns nothing from any of
           them. */
        aria-label={paid ? `Take down listing: ${title}` : `Delete listing: ${title}`}
      >
        {paid ? "Take down" : "Delete"}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      {paid ? (
        <span className="max-w-[22rem] text-right text-xs text-fg-2">
          It stops showing straight away, and this is not refunded — neither the days it has
          run nor the days it has left.
        </span>
      ) : null}
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="rounded-control bg-warn-tint px-2 py-1 text-xs font-medium text-warn-text disabled:opacity-60"
          aria-label={`Confirm delete: ${title}`}
        >
          {busy ? "Deleting…" : paid ? "Take it down" : "Delete it"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs text-fg-2 underline underline-offset-2"
        >
          Keep
        </button>
      </span>
    </span>
  );
}
