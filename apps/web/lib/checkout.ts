import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sending a buyer to pay, in one place.
 *
 * ## Both doors lead to our own page now
 *
 * There are two ways to reach payment — the Pay button on a listing somebody
 * came back to, and the redirect straight after submitting a listing they
 * chose to promote. Both now go to `/recruit/campaigns/<id>/pay`, a page on
 * this site that opens the provider's checkout in an overlay.
 *
 * They used to go to the provider's hosted page directly, which ends by
 * obeying a store-wide redirect setting. The store is shared with another
 * product, so the first real buyer paid for a listing and was delivered to
 * somebody else's website with no confirmation and no way back. There is no
 * per-checkout redirect parameter to fix that with.
 *
 * ## Why the fallback row is written where the buyer arrives
 *
 * `pending_checkouts` is how a payment is matched to what it paid for when the
 * payment comes back without a campaign id — which is what happens in
 * practice, because the id does not survive the checkout unless it is a
 * declared custom field the buyer can see and must fill in.
 *
 * It is written by the pay page, at the moment somebody actually arrives to
 * pay. Writing it when the listing is created instead would record intent
 * rather than arrival, and leave a trail of rows for people who never got as
 * far as the payment window.
 */

type PayableCampaign = { id: string; days: number; price_usd: number | string | null };

/** Where a buyer goes to pay for a campaign. Our own page, deliberately. */
export function payUrlFor(campaignId: string): string {
  return `/recruit/campaigns/${campaignId}/pay`;
}

/**
 * Record that this buyer was sent to pay for this campaign.
 *
 * Email plus amount, which is what the webhook matches on when the payload
 * carries no campaign id. A weaker key than an id — two campaigns of the same
 * price bought by the same person on the same day are genuinely ambiguous —
 * which is why the id is still sent as well, and why the webhook prefers it.
 */
export async function recordPendingCheckout(
  admin: SupabaseClient,
  campaign: PayableCampaign,
  buyerEmail: string | null,
): Promise<void> {
  /*
   * One row per campaign per day, not one per page load.
   *
   * This page is a normal URL: it is refreshed, reopened from history, and
   * revisited after a cancelled payment. Each of those would otherwise add an
   * identical unconsumed row, and the webhook picks the most recent match — so
   * the duplicates are harmless but they bury the audit trail in noise exactly
   * when somebody is reading it to work out where a payment went.
   */
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: existing } = await admin
    .from("pending_checkouts")
    .select("campaign_id")
    .eq("campaign_id", campaign.id)
    .is("consumed_at", null)
    .gte("created_at", since)
    .limit(1);
  if (existing?.length) return;

  const { error } = await admin.from("pending_checkouts").insert({
    campaign_id: campaign.id,
    provider: "fungies",
    buyer_email: buyerEmail,
    amount: campaign.price_usd,
  });

  /*
   * Logged, never fatal.
   *
   * Losing the fallback costs a manual reconciliation later; refusing to open
   * the checkout costs the sale now. The first is recoverable from
   * /admin/payments and the second is not recoverable at all.
   */
  if (error) console.error("[checkout] pending_checkouts failed:", error.message);
}
