"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

/**
 * The payment step, on our own page.
 *
 * ## Why the payment is in a frame here rather than a page over there
 *
 * The provider's hosted page finishes by obeying a store-wide "Instant
 * Redirect URL". That store is shared with another product, so the first
 * person who bought a listing paid for it and was delivered to somebody else's
 * website — no confirmation, no listing, no way back. There is no per-checkout
 * redirect parameter to override it with, and the store setting belongs to the
 * other product.
 *
 * Opening the checkout in an overlay takes the question away. The SDK raises
 * `fungies:checkout:complete` on `document` when the payment succeeds, and
 * from there this component sends the buyer to their own listing.
 *
 * ## What this component does NOT do
 *
 * Mark anything paid. `complete` means the buyer's browser was told the
 * payment went through, which is a claim made to a page anyone can open. Only
 * the signed webhook moves money state, and the page this redirects to says
 * "confirming" until that webhook has actually landed.
 */

type Props = {
  checkoutUrl: string;
  campaignId: string;
  email: string | null;
  /** Where to send somebody whose browser cannot run the overlay. */
  fallbackUrl: string | null;
  priceLabel: string;
};

type FungiesSdk = {
  Initialize: (options?: { enableDataAttributes?: boolean }) => void;
  Checkout: {
    open: (options: {
      checkoutUrl: string;
      settings: { mode: "overlay" | "embed"; frameTarget?: string };
      billingData?: { email?: string };
    }) => void;
    close: () => void;
  };
};

declare global {
  interface Window {
    /*
     * The CDN build puts the whole MODULE NAMESPACE on `window.Fungies`, so
     * the SDK itself is at `window.Fungies.Fungies`. The published example is
     * written for the npm package, where `import { Fungies }` unwraps that
     * level — copy it to a script tag and `window.Fungies.Initialize` is not a
     * function. It is the first thing this component does, and it threw.
     */
    Fungies?: FungiesSdk | { Fungies?: FungiesSdk };
  }
}

/** The SDK, whichever of the two shapes the loaded build uses. */
function resolveSdk(): FungiesSdk | null {
  const ns = window.Fungies;
  if (!ns) return null;
  const inner = (ns as { Fungies?: FungiesSdk }).Fungies;
  const sdk = inner ?? (ns as FungiesSdk);
  return typeof sdk?.Initialize === "function" && sdk.Checkout ? sdk : null;
}

const SDK_SRC = "https://cdn.jsdelivr.net/npm/@fungies/fungies-js@0";

export default function CheckoutOverlay({
  checkoutUrl,
  campaignId,
  email,
  fallbackUrl,
  priceLabel,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ready" | "closed" | "broken">("loading");
  /** Set the moment payment succeeds, so the close that follows is not a cancel. */
  const completed = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const onComplete = () => {
      completed.current = true;
      /*
       * Shut the overlay before leaving.
       *
       * The frame does not unmount on its own — the SDK appended it to the
       * document, outside React's tree, so a client-side navigation moves the
       * page underneath and leaves the checkout's own "get your product"
       * screen sitting on top of it. The buyer is then looking at the payment
       * provider's success page when they should be looking at their listing,
       * with no obvious way out.
       */
      try {
        resolveSdk()?.Checkout.close();
      } catch (err) {
        console.error("[checkout] could not close the overlay:", err);
      }

      // `replace`, not `push`: the back button should not return somebody to a
      // payment page for something they have just paid for.
      router.replace(`/recruit/campaigns/${campaignId}?paid=1`);
    };

    /*
     * Closing it above fires `close` as well, and that must not be read as a
     * cancellation — "Payment cancelled" flashing up at somebody who has just
     * paid is the worst message this component could show. The flag is a ref
     * rather than state because it is set and read inside the same tick.
     */
    const onClose = () => {
      if (completed.current) return;
      setState((s) => (s === "ready" ? "closed" : s));
    };

    document.addEventListener("fungies:checkout:complete", onComplete);
    document.addEventListener("fungies:checkout:close", onClose);

    function open() {
      if (cancelled) return;
      const sdk = resolveSdk();
      if (!sdk) {
        setState("broken");
        return;
      }
      try {
        sdk.Initialize({ enableDataAttributes: false });
        sdk.Checkout.open({
          checkoutUrl,
          settings: { mode: "overlay" },
          billingData: email ? { email } : undefined,
        });
        setState("ready");
      } catch (err) {
        console.error("[checkout] overlay failed to open:", err);
        setState("broken");
      }
    }

    if (resolveSdk()) {
      open();
    } else {
      /*
       * Loaded here rather than with next/script so that a failure to fetch it
       * is observable. A blocked CDN — an ad blocker will do it — must show the
       * hosted-checkout link rather than an overlay that silently never opens.
       */
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
      const script = existing ?? document.createElement("script");
      script.addEventListener("load", open);
      script.addEventListener("error", () => !cancelled && setState("broken"));
      if (!existing) {
        script.src = SDK_SRC;
        script.defer = true;
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      document.removeEventListener("fungies:checkout:complete", onComplete);
      document.removeEventListener("fungies:checkout:close", onClose);
    };
  }, [checkoutUrl, campaignId, email, router]);

  if (state === "broken") {
    return (
      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="mt-0 text-lg">Open the payment page</h2>
        <p className="m-0 mt-2 text-fg-2">
          The payment window could not open here — usually a tracking blocker stopping the
          payment provider&apos;s script. You can pay on their page instead.
        </p>
        {fallbackUrl ? (
          <div className="mt-4">
            <ButtonLink href={fallbackUrl}>Pay {priceLabel} on the payment page</ButtonLink>
          </div>
        ) : null}
        <p className="m-0 mt-3 text-sm text-fg-2">
          That page finishes on the payment provider&apos;s own site rather than back here. Your
          listing still goes live as soon as the payment clears — check{" "}
          <a
            href={`/recruit/campaigns/${campaignId}`}
            className="text-action-text underline underline-offset-2"
          >
            your listing
          </a>{" "}
          a minute later.
        </p>
      </div>
    );
  }

  if (state === "closed") {
    return (
      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="mt-0 text-lg">Payment cancelled</h2>
        <p className="m-0 mt-2 text-fg-2">
          Nothing was charged and your listing is saved. You can pay whenever you are ready.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={() => window.location.reload()}>Try again</Button>
          <ButtonLink href={`/recruit/campaigns/${campaignId}`} variant="ghost">
            Back to the listing
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <p className="m-0 flex items-center gap-2 text-fg-2" role="status">
        <Spinner />
        Opening the payment window…
      </p>
      <p className="m-0 mt-2 text-sm text-fg-2">
        Nothing is charged until you confirm it there.
      </p>
    </div>
  );
}
