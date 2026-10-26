"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { CONTACT } from "@/lib/contact";

/**
 * "Your payment went through — we are confirming it."
 *
 * ## Why there is a waiting state at all
 *
 * The buyer's browser learns the payment succeeded before we do. It is told by
 * the checkout frame; we are told by a signed webhook, over a different
 * connection, a moment later. Between those two things the buyer is looking at
 * a listing that is not live yet, having just paid for it — which reads as a
 * failure unless the page says otherwise.
 *
 * ## Why the browser is not simply believed
 *
 * `fungies:checkout:complete` arrives in a page that anybody can open, and the
 * URL that carries it here is one somebody can type. Treating either as proof
 * of payment would mean a free listing for anyone who worked that out. So this
 * component says only what is true — a payment was reported, and we are
 * waiting for the provider to confirm it — and money state is moved by the
 * webhook alone.
 *
 * It refreshes the server component a few times and then stops. If the webhook
 * has still not landed by then, something is wrong in a way that another
 * refresh will not fix, and the copy says who to ask.
 */

const TRIES = 6;
const EVERY_MS = 5_000;

export default function PaymentConfirming() {
  const router = useRouter();
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (tries >= TRIES) return;
    const timer = setTimeout(() => {
      /*
       * `refresh` re-runs the server component, which re-reads the campaign.
       * When the webhook has landed, `paid_at` is set and the page stops
       * rendering this component at all — so there is no "done" state here to
       * get out of step with the database.
       */
      router.refresh();
      setTries((n) => n + 1);
    }, EVERY_MS);
    return () => clearTimeout(timer);
  }, [tries, router]);

  const givenUp = tries >= TRIES;

  return (
    <div className="mt-4 grid gap-2 rounded-card border border-line bg-surface p-4" role="status">
      <p className="m-0 flex items-center gap-2 text-sm">
        {givenUp ? null : <Spinner />}
        <strong className="font-semibold">Payment received.</strong>{" "}
        {givenUp
          ? "It is taking longer than usual to confirm."
          : "We are confirming it with the payment provider — this usually takes a few seconds."}
      </p>
      <p className="m-0 text-sm text-fg-2">
        {givenUp ? (
          <>
            Your payment is safe and nothing is lost. Reload this page in a minute, and if the
            listing is still not live,{" "}
            {CONTACT.email ? (
              <>
                email{" "}
                <a
                  href={`mailto:${CONTACT.email}`}
                  className="text-action-text underline underline-offset-2"
                >
                  {CONTACT.email}
                </a>{" "}
                and we will sort it out.
              </>
            ) : (
              "contact us and we will sort it out."
            )}
          </>
        ) : (
          "Your listing goes live the moment it is confirmed. You can leave this page."
        )}
      </p>
    </div>
  );
}
