"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

/**
 * "Pay now", with an honest fallback.
 *
 * Card checkout is the last piece of this to be switched on. Until it is, the
 * route answers 503 with a sentence explaining that an invoice is coming — so
 * this button shows that sentence rather than an error. A buyer who clicks Pay
 * and sees "something went wrong" assumes the site is broken and does not try
 * again; one who sees "we will email a payment link within one business day"
 * has been served.
 */
export default function PayButton({
  campaignId,
  priceLabel,
}: {
  campaignId: string;
  priceLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/recruit/campaigns/${campaignId}/checkout`, { method: "POST" });
      const json = await res.json();
      if (res.ok && json.url) {
        // A full navigation, not a fetch: the checkout is somebody else's site.
        window.location.href = json.url;
        return;
      }
      setMessage(json.error ?? "Could not start the payment.");
    } catch {
      setMessage("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div>
        <Button onClick={pay} disabled={busy}>
          {busy ? <Spinner className="me-2" /> : null}
          {busy ? "Opening checkout…" : `Pay ${priceLabel}`}
        </Button>
      </div>
      {message ? (
        <p className="m-0 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text">
          {message}
        </p>
      ) : null}
    </div>
  );
}
