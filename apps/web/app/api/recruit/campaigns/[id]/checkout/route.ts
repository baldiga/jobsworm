import { NextResponse } from "next/server";
import { createAdminClient, supabaseConfigured } from "@/lib/supabase";
import { getRecruiter } from "@/lib/recruit";
import { fungiesConfig } from "@/lib/fungies";
import { payUrlFor } from "@/lib/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send a buyer to the hosted checkout.
 *
 * ## Why a `pending_checkouts` row is written first
 *
 * The campaign id is supposed to travel to the payment page in a product-level
 * Custom Field and come back on the webhook. That is one link in a chain we do
 * not control: the field may not pre-fill from a URL (only `fngs-user-email`
 * and `fngs-quantity` are documented as pre-fillable), the buyer may reach the
 * payment page some other way, or the provider may simply not echo it.
 *
 * If that link breaks, the webhook arrives with a payment and no idea what it
 * paid for. This row is the fallback: email plus amount, written before the
 * buyer leaves, so the payment can be matched afterwards. Without it a real
 * payment sits in `payment_events` unattached and somebody has to work out by
 * hand who it belonged to.
 *
 * ## It does not mark anything paid
 *
 * Reaching the checkout page is not paying. Only the signed webhook moves a
 * campaign to paid, because only the webhook is evidence that money changed
 * hands. A "success" redirect is display-only and is trivially forged by
 * typing the URL.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // No allowlist any more; the campaign is matched to `recruiter.user_id`
  // below, which is what keeps one recruiter out of another's checkout.
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const config = fungiesConfig();
  if (!config) {
    /*
     * 503 and a sentence, not a crash. Self-serve checkout is the last piece
     * of this to be set up, and until it is the invoice path is how listings
     * get paid for — so the honest answer is "not this way, yet".
     */
    return NextResponse.json(
      {
        error:
          "Card payment is not switched on yet. We will send a payment link by email within one business day.",
      },
      { status: 503 },
    );
  }

  const { id } = await params;
  const recruiter = await getRecruiter();
  if (!recruiter) return NextResponse.json({ error: "not a recruiter" }, { status: 403 });

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, recruiter_id, plan, days, price_usd, status, paid_at")
    .eq("id", id)
    .maybeSingle();

  // Somebody else's campaign is indistinguishable from one that does not exist.
  if (!campaign || campaign.recruiter_id !== recruiter.user_id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (campaign.plan === "free") {
    return NextResponse.json({ error: "This listing is free — nothing to pay." }, { status: 409 });
  }
  if (campaign.paid_at) {
    return NextResponse.json({ error: "This listing is already paid for." }, { status: 409 });
  }
  if (["ended", "refunded", "cancelled", "rejected"].includes(campaign.status)) {
    return NextResponse.json({ error: "This listing has finished." }, { status: 409 });
  }

  return NextResponse.json({ ok: true, url: payUrlFor(campaign.id) });
}
