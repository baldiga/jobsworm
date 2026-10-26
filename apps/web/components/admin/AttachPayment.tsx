"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * Attach an orphan payment to the campaign it belongs to.
 *
 * The choice is a plain select of campaigns awaiting payment, because that is
 * a short list and the answer is almost always obvious from the payload above.
 * There is no "search all campaigns": a payment should never be attached to
 * one that is already paid, and offering the option invites the mistake.
 */
export default function AttachPayment({
  provider,
  eventId,
  campaigns,
}: {
  provider: string;
  eventId: string;
  campaigns: { id: string; label: string; priceUsd: number }[];
}) {
  const router = useRouter();
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function attach() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, event_id: eventId, campaign_id: campaignId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not attach it.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!campaigns.length) {
    return (
      <p className="m-0 text-sm text-fg-2">
        No campaigns are awaiting payment, so this does not belong to one. It may be a duplicate,
        a test, or a refund for something already settled.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">Attach to</span>
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          className="min-h-11 rounded-control border border-line bg-surface px-3"
        >
          <option value="">Choose a campaign…</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={attach} disabled={busy || !campaignId}>
          {busy ? "Attaching…" : "Attach and mark paid"}
        </Button>
        {error ? (
          <p role="alert" className="m-0 text-sm text-warn-text">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
