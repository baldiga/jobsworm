import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireRecruiter } from "@/lib/recruit";
import { createAdminClient, createReadClient } from "@/lib/supabase";
import { campaignCheckoutUrl, campaignOverlayUrl, fungiesConfig } from "@/lib/fungies";
import { recordPendingCheckout } from "@/lib/checkout";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ButtonLink } from "@/components/ui/Button";
import { formatUsd } from "@/lib/format";
import CheckoutOverlay from "@/components/recruit/CheckoutOverlay";

export const metadata: Metadata = {
  title: "Payment",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  plan: string;
  status: string;
  title_snapshot: string | null;
  days: number;
  price_usd: number | string;
  paid_at: string | null;
};

/**
 * Where a buyer pays, on our own domain.
 *
 * The payment itself happens in a frame from the provider; what matters is
 * that the page around it is ours, so that finishing takes the buyer to their
 * listing instead of wherever a store-wide setting points. See
 * `CheckoutOverlay` for the full reason.
 *
 * The `pending_checkouts` row is written here, at the moment somebody actually
 * arrives to pay, because this is the last point on our side before the money
 * moves. It is what the webhook falls back to when the payment comes back
 * without a campaign id attached — which is what happens in practice.
 */
export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recruiter = await requireRecruiter(`/recruit/campaigns/${id}/pay`);

  const supabase = await createReadClient();
  const { data: campaigns } = await supabase.rpc("recruiter_my_campaigns");
  const campaign = ((campaigns as Row[] | null) ?? []).find((c) => c.id === id);

  // The RPC filters on auth.uid(), so somebody else's campaign and one that
  // does not exist arrive here identically, and leave identically.
  if (!campaign) notFound();

  // Nothing to pay, or nothing left to pay for. Both belong on the listing.
  if (campaign.plan === "free" || campaign.paid_at) redirect(`/recruit/campaigns/${id}`);
  if (["ended", "refunded", "cancelled", "rejected"].includes(campaign.status)) {
    redirect(`/recruit/campaigns/${id}`);
  }

  const priceLabel = formatUsd(campaign.price_usd) ?? "";
  const configured = Boolean(fungiesConfig());
  const overlayUrl = configured ? campaignOverlayUrl(campaign.days) : null;
  const hostedUrl = configured
    ? campaignCheckoutUrl(campaign.days, campaign.id, recruiter.contact_email)
    : null;

  if (overlayUrl || hostedUrl) {
    await recordPendingCheckout(createAdminClient(), campaign, recruiter.contact_email);
  }

  return (
    <PageShell width="narrow">
      <SectionHeading
        level={1}
        kicker="Payment"
        title={`Pay ${priceLabel} for ${campaign.days} days`}
        subtitle={campaign.title_snapshot ?? undefined}
      />

      <div className="mt-6">
        {overlayUrl ? (
          <CheckoutOverlay
            checkoutUrl={overlayUrl}
            campaignId={campaign.id}
            email={recruiter.contact_email}
            fallbackUrl={hostedUrl}
            priceLabel={priceLabel}
          />
        ) : hostedUrl ? (
          /*
           * No checkout element configured. The hosted link still takes a
           * payment; it just finishes on the provider's own page rather than
           * back here, so the buyer is told that before they go.
           */
          <div className="rounded-card border border-line bg-surface p-5">
            <h2 className="mt-0 text-lg">Pay on the payment page</h2>
            <p className="m-0 mt-2 text-fg-2">
              Payment is handled by our payment provider. After paying you will be on their
              page — come back here and your listing will go live as soon as the payment clears.
            </p>
            <div className="mt-4">
              <ButtonLink href={hostedUrl}>Pay {priceLabel}</ButtonLink>
            </div>
          </div>
        ) : (
          <div className="rounded-card border border-line bg-surface p-5">
            <h2 className="mt-0 text-lg">We will invoice you</h2>
            <p className="m-0 mt-2 text-fg-2">
              Card payment is not switched on for this length yet. We will send a payment link
              by email within one business day, and your listing goes live as soon as it is
              paid.
            </p>
            <div className="mt-4">
              <ButtonLink href={`/recruit/campaigns/${campaign.id}`} variant="ghost">
                Back to the listing
              </ButtonLink>
            </div>
          </div>
        )}
      </div>

      <p className="m-0 mt-6 text-sm text-fg-2">
        Your listing is already saved. You can{" "}
        <ButtonLink href={`/recruit/campaigns/${campaign.id}/edit`} variant="ghost" size="sm">
          edit it
        </ButtonLink>{" "}
        before or after paying.
      </p>
    </PageShell>
  );
}
