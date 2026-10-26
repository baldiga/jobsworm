"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * Closing a listing before its time is up.
 *
 * The confirmation is a second click rather than a modal: this is reversible
 * in the sense that the listing can be posted again, and a dialog for it would
 * be heavier than the decision.
 *
 * Paid listings included. Ending one early used to go through a person,
 * because it seemed like a refund conversation — but the reason people reach
 * for this is that the role was filled, and a site that fights ghost jobs
 * cannot be the obstacle to taking a filled vacancy down.
 *
 * There is no refund, and the confirmation says so before the click rather
 * than after it. That is what makes it safe to offer the button at all: the
 * trade is stated, and the person deciding is the one who benefits from the
 * role coming down.
 */
export default function CloseListingButton({
  campaignId,
  paid = false,
}: {
  campaignId: string;
  /** Paid and running: the confirmation has to mention the money. */
  paid?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function close() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recruit/campaigns/${campaignId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not close the listing.");
        return;
      }
      router.push("/recruit/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
        {paid ? "Take this listing down" : "Close this listing"}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {paid ? (
        <p className="m-0 w-full text-sm text-fg-2">
          It stops showing straight away, and this is not refunded — neither the days it has
          run nor the days it has left. If the role is filled that is the right trade; if you
          are not sure, edit it instead.
        </p>
      ) : null}
      <Button type="button" variant="danger" onClick={close} disabled={busy}>
        {busy ? "Closing…" : paid ? "Yes, take it down" : "Yes, close it"}
      </Button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-sm text-fg-2 underline underline-offset-4"
      >
        Keep it running
      </button>
      {error ? (
        <p role="alert" className="m-0 text-sm text-warn-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
