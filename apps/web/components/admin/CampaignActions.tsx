"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * The review buttons.
 *
 * Rejecting and refunding ask for a reason before they fire, because both send
 * somebody an outcome they did not want and "no reason given" is the thing
 * that turns a refusal into an argument. Approving does not: nobody needs an
 * explanation for a yes.
 */
export default function CampaignActions({
  campaignId,
  status,
  plan,
  priceUsd,
  paid,
}: {
  campaignId: string;
  status: string;
  plan: string;
  priceUsd: number;
  paid: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [invoice, setInvoice] = useState("");

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "That did not work.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const finished = ["ended", "refunded", "cancelled", "rejected"].includes(status);

  return (
    <div className="grid gap-4">
      {error ? (
        <p role="alert" className="m-0 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text">
          {error}
        </p>
      ) : null}

      {!finished && plan === "sponsored" ? (
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => run("approve")} disabled={busy !== null}>
            {busy === "approve" ? "Approving…" : "Approve"}
          </Button>

          {!paid ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
                placeholder="GI-1234"
                className="numeral min-h-11 w-36 rounded-control border border-line bg-surface px-3"
                dir="ltr"
              />
              <Button
                variant="secondary"
                onClick={() => run("mark_paid", { ref: invoice, amount: priceUsd })}
                disabled={busy !== null || invoice.trim().length < 2}
              >
                {busy === "mark_paid" ? "Recording…" : `Mark paid $${priceUsd}`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!finished ? (
        <div className="grid gap-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">
              Reason <span className="font-normal text-fg-2">(sent to the buyer)</span>
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="This looks like a course rather than a vacancy."
              className="min-h-11 rounded-control border border-line bg-surface px-3"
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="danger"
              onClick={() => run(plan === "free" ? "unpublish" : "reject", { reason })}
              disabled={busy !== null || reason.trim().length < 3}
            >
              {plan === "free" ? "Take it down" : "Reject"}
            </Button>

            {status === "live" ? (
              <Button variant="ghost" onClick={() => run("end")} disabled={busy !== null}>
                End now, no refund
              </Button>
            ) : null}

            {paid ? (
              <Button variant="ghost" onClick={() => run("refund")} disabled={busy !== null}>
                Refund and close
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="m-0 text-sm text-fg-2">This campaign is finished. Nothing left to do.</p>
      )}
    </div>
  );
}
