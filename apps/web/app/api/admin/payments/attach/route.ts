import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createReadClient, createAdminClient, supabaseConfigured } from "@/lib/supabase";
import { isAdminEmail } from "@/lib/admin";
import { parseFungiesEvent } from "@/lib/fungies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Attach a stored payment event to a campaign, by hand.
 *
 * The amount and reference come from the STORED PAYLOAD, never from the
 * request body. The only thing a person supplies here is which campaign the
 * payment belongs to; everything about the payment itself is read back from
 * what the provider actually signed and sent. That keeps this endpoint unable
 * to invent a payment, which is the property worth having on a route that
 * marks things paid.
 */
export async function POST(request: Request) {
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const supabase = await createReadClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: { provider?: string; event_id?: string; campaign_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const provider = String(body.provider ?? "");
  const eventId = String(body.event_id ?? "");
  const campaignId = String(body.campaign_id ?? "");
  if (!provider || !eventId || !campaignId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: event } = await admin
    .from("payment_events")
    .select("provider, event_id, event_type, payload, processed")
    .eq("provider", provider)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "event not found" }, { status: 404 });
  if (event.processed) {
    return NextResponse.json({ error: "That event was already processed." }, { status: 409 });
  }

  const parsed = parseFungiesEvent(event.payload);

  const { error: rpcError } = await admin.rpc("mark_campaign_paid", {
    p_campaign_id: campaignId,
    p_provider: provider,
    p_ref: parsed?.orderId ?? eventId,
    p_amount: parsed?.amount ?? null,
    p_currency: parsed?.currency ?? "ILS",
  });
  if (rpcError) {
    console.error("[admin] attach payment failed:", rpcError.message);
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  await admin
    .from("payment_events")
    .update({ processed: true, campaign_id: campaignId })
    .eq("provider", provider)
    .eq("event_id", eventId);

  revalidatePath("/");
  revalidatePath("/jobs");

  return NextResponse.json({ ok: true });
}
