import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient, supabaseConfigured } from "@/lib/supabase";
import {
  classifyEvent,
  fetchFungiesOrder,
  fungiesConfig,
  orderAmountMajor,
  normaliseEmailForMatch,
  parseFungiesEvent,
  verifyFungiesSignature,
} from "@/lib/fungies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The payment webhook.
 *
 * This is the only thing in the system that can mark a campaign paid, so it is
 * written to the rules that matter for money rather than the ones that matter
 * for a page.
 *
 * ## 1. The raw body, before anything else
 *
 * `request.text()`, not `request.json()`. The signature is an HMAC over the
 * exact bytes that were sent; parsing and re-serialising reorders keys and
 * drops whitespace, and the signature would never match again. Parsing happens
 * after verification, on a body we have already decided to trust.
 *
 * ## 2. Bad signature is a 401 and nothing else
 *
 * No row written, no log of the contents, no partial work. An unsigned request
 * to this endpoint is somebody trying to give themselves a free advert.
 *
 * ## 3. Record before acting, and answer 200 once recorded
 *
 * The insert into `payment_events` uses the provider's own idempotency key as
 * the primary key. A replay therefore CONFLICTS, and a conflict is a success:
 * the event is already recorded, so we answer 200 and do the work zero more
 * times. Payment providers retry aggressively and duplicate delivery is
 * normal, not an edge case.
 *
 * The only 500 this returns is when that insert genuinely failed — because a
 * 500 is what makes the provider retry, and an event we could not even record
 * is exactly the one worth retrying.
 *
 * ## 4. Three ways to find the campaign, in order of trust
 *
 *   a. The custom field on the event.
 *   b. A `pending_checkouts` row matching email and amount in the last 24h.
 *   c. Nothing — the event is stored unprocessed and appears in the admin
 *      queue for a person to attach. A payment we cannot place is a payment
 *      somebody made; dropping it is not an option.
 */
export async function POST(request: Request) {
  const config = fungiesConfig();
  if (!config || !supabaseConfigured) {
    // 503 rather than 404: the endpoint exists and is simply not switched on,
    // and the provider's dashboard should show a retriable failure.
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const raw = await request.text();
  const signature = request.headers.get(config.header);

  if (!verifyFungiesSignature(raw, signature, config.secret)) {
    /*
     * 403, and log enough to debug without logging the body.
     *
     * The body is somebody's payment details. The first 30 characters of the
     * signature and the body length are enough to tell a format change from a
     * wrong secret from a forgery, and none of them is personal. When the
     * signing format changed on another integration, that log line was the
     * difference between minutes and days.
     */
    console.error(
      `[fungies] bad signature: header=${(signature ?? "").slice(0, 30)} bodyLen=${raw.length}`,
    );
    return NextResponse.json({ error: "bad signature" }, { status: 403 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const event = parseFungiesEvent(parsed);
  if (!event) {
    // Signed, so it is really from them, but with no idempotency key there is
    // no safe way to process it. 200 so it is not retried forever.
    console.error("[fungies] signed event with no idempotency key");
    return NextResponse.json({ ok: true, ignored: "no idempotency key" });
  }

  const admin = createAdminClient();
  const kind = classifyEvent(event.type);

  /*
   * A test event in production is stored and NOT acted on.
   *
   * The dashboard's Test button is how the signature header gets discovered,
   * and it will be pressed against whatever endpoint is configured — which may
   * well be production. Storing it proves the pipe works; acting on it would
   * hand somebody a free 28-day advert.
   */
  const testInProd = event.testMode && !config.allowTest;

  /* ---- 1. record ------------------------------------------------------- */
  const { error: insertError } = await admin.from("payment_events").insert({
    provider: "fungies",
    event_id: event.eventId,
    event_type: event.type,
    payload: parsed as Record<string, unknown>,
    processed: false,
  });

  if (insertError) {
    // 23505 is unique_violation: we have seen this event. That is a success.
    const duplicate =
      insertError.code === "23505" || /duplicate key|already exists/i.test(insertError.message);
    if (duplicate) return NextResponse.json({ ok: true, duplicate: true });

    console.error("[fungies] could not record event:", insertError.message);
    // The one case worth a retry.
    return NextResponse.json({ error: "could not record event" }, { status: 500 });
  }

  if (testInProd) {
    // 202: acknowledged, deliberately not acted on. Retrying will not help.
    return NextResponse.json(
      { ok: true, stored: true, processed: false, reason: "test mode" },
      { status: 202 },
    );
  }
  if (kind === "other" || kind === "failed") {
    // Recorded for the audit trail. A failed payment changes nothing: the
    // campaign was never paid, and it stays that way.
    await admin
      .from("payment_events")
      .update({ processed: true })
      .eq("provider", "fungies")
      .eq("event_id", event.eventId);
    return NextResponse.json(
      { ok: true, stored: true, processed: false, type: event.type },
      { status: 202 },
    );
  }

  /* ---- 2. find the campaign -------------------------------------------- */
  /*
   * Four keys, strongest first, and the weakest one refuses to guess.
   *
   * A payment has to be attached to what it paid for. The provider does not
   * carry our campaign id through checkout — custom fields are dropped unless
   * they are declared on the product and shown to the buyer — so most of the
   * time this falls through to matching against the row written when the buyer
   * was sent to pay.
   *
   * Exact email alone was not enough, and a real payment proved it: the
   * recruiter's account was `office+2@…` while the provider reported the card
   * account as `office@…`. The listing sat on "waiting for payment" behind a
   * success screen. Worse, a buyer may simply type a different address at
   * checkout from the one on their account, and nothing stops them.
   *
   * So the last key ignores the address entirely and matches on price — but
   * ONLY when exactly one unpaid checkout in the window has that price. If two
   * campaigns are both waiting at $80 it stays unmatched and goes to the admin
   * queue, which is the correct outcome: an unattached payment is recoverable
   * in a minute, and one attached to the wrong listing is a refund and an
   * apology.
   */
  let campaignId = event.campaignId;

  if (!campaignId) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: pending } = await admin
      .from("pending_checkouts")
      .select("campaign_id, amount, buyer_email")
      .eq("provider", "fungies")
      .is("consumed_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);

    const rows = pending ?? [];
    /*
     * The LINE ITEM price before the order total: a discount makes those two
     * different numbers, and only the first still matches what the campaign
     * costs. The shared store carries a 100% code, so an order total of 0
     * against an $80 listing is a real case, not a corner one.
     */
    const prices = [event.itemAmount, event.amount].filter(
      (v): v is number => v != null && Number.isFinite(v),
    );
    const samePrice = (r: { amount: number | string | null }) =>
      prices.some((v) => Number(r.amount) === Number(v));

    const exact = event.email
      ? rows.filter((r) => r.buyer_email === event.email)
      : [];
    const wantNorm = normaliseEmailForMatch(event.email);
    const loose = wantNorm
      ? rows.filter((r) => normaliseEmailForMatch(r.buyer_email) === wantNorm)
      : [];

    const pick =
      exact.find(samePrice) ??
      loose.find(samePrice) ??
      (exact.length === 1 ? exact[0] : undefined) ??
      (loose.length === 1 ? loose[0] : undefined) ??
      // Nobody's address matched. One unpaid checkout at this exact price is
      // unambiguous on its own; two are not, and are left for a person.
      (() => {
        const byPrice = rows.filter(samePrice);
        return byPrice.length === 1 ? byPrice[0] : undefined;
      })();

    campaignId = pick?.campaign_id ?? null;

    if (!campaignId && rows.length) {
      console.error(
        `[fungies] ${event.eventId}: ${rows.length} pending checkout(s) in the window, ` +
          `none unambiguously matched buyer=${event.email ?? "?"} ` +
          `price=${prices.join("/") || "?"}`,
      );
    }
  }

  if (!campaignId) {
    // Left unprocessed on purpose: it shows up in the admin payments queue.
    console.error(`[fungies] payment ${event.eventId} could not be matched to a campaign`);
    return NextResponse.json(
      { ok: true, stored: true, processed: false, reason: "unmatched" },
      { status: 202 },
    );
  }

  /* ---- 3. prove the money is real --------------------------------------- */
  /*
   * The signature proved the body came from them. It did NOT prove anybody
   * paid: a replayed or crafted-but-signed body would sail through everything
   * above. So the order is re-read over the authenticated API and has to say
   * PAID before a listing goes live.
   *
   * It also covers their database lagging behind their own webhook fanout,
   * which is a real thing that happens.
   *
   * A failure to CHECK is not a failure to pay. 500 so they retry, because
   * "we could not reach the API" and "this was never paid" must not have the
   * same outcome — one of those silently drops somebody's purchase.
   */
  if (kind === "paid") {
    if (!event.orderId) {
      console.error(`[fungies] ${event.eventId} has no order id; leaving for /admin`);
      return NextResponse.json(
        { ok: true, stored: true, processed: false, reason: "no order id" },
        { status: 202 },
      );
    }
    const order = await fetchFungiesOrder(event.orderId);
    if (!order) {
      return NextResponse.json({ error: "could not verify the order" }, { status: 500 });
    }
    if ((order.status ?? "").toUpperCase() !== "PAID") {
      console.error(`[fungies] order ${event.orderId} is ${order.status}, not PAID`);
      return NextResponse.json(
        { ok: true, stored: true, processed: false, reason: `order ${order.status}` },
        { status: 202 },
      );
    }
    // Prefer the amount the ORDER says over the one the event said: the order
    // is the authenticated source, and `currencyDecimals` is how many minor
    // units this currency has — 2 for dollars, 0 for yen.
    const major = orderAmountMajor(order);
    if (major != null) event.amount = major;
    if (order.currency) event.currency = order.currency;
  }

  /* ---- 4. act ---------------------------------------------------------- */
  let rpcError: { message: string } | null = null;

  if (kind === "paid") {
    ({ error: rpcError } = await admin.rpc("mark_campaign_paid", {
      p_campaign_id: campaignId,
      p_provider: "fungies",
      p_ref: event.orderId ?? event.eventId,
      p_amount: event.amount,
      p_currency: event.currency ?? "ILS",
    }));
  } else if (kind === "refunded") {
    ({ error: rpcError } = await admin.rpc("refund_campaign", { p_campaign_id: campaignId }));
  }

  if (rpcError) {
    console.error(`[fungies] ${kind} on ${campaignId} failed:`, rpcError.message);
    // The event IS recorded, so this is not retried. It stays unprocessed and
    // a person finishes it from /admin — better than a retry loop against an
    // RPC that will keep failing for the same reason.
    // 500: a DB failure is transient, and a retry is exactly what should
    // happen. The event row already exists, so the retry is a cheap no-op on
    // everything before this point.
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  await admin
    .from("payment_events")
    .update({ processed: true, campaign_id: campaignId })
    .eq("provider", "fungies")
    .eq("event_id", event.eventId);

  await admin
    .from("pending_checkouts")
    .update({ consumed_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .is("consumed_at", null);

  // The listing may have just gone live. Both cached surfaces need to know.
  revalidatePath("/");
  revalidatePath("/jobs");

  return NextResponse.json(
    { ok: true, stored: true, processed: true, campaign_id: campaignId },
    { status: 202 },
  );
}
