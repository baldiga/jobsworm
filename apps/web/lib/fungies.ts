import { createHmac, timingSafeEqual } from "node:crypto";
import { PACKAGES } from "@jobsworm/core";

/**
 * fungies.io — hosted checkout and its webhook.
 *
 * ## Why a merchant of record at all
 *
 * Selling to Israeli businesses means VAT, invoices and a payment processor
 * relationship. A merchant of record is the seller on paper: they take the
 * payment, handle the tax, and pay out. For a one-person project selling a
 * $80 advert that is the difference between shipping this month and spending
 * it on compliance.
 *
 * The Green Invoice path stays alongside it and is what the first customers
 * will use — `mark_campaign_paid` with a `greeninvoice` provider and an
 * invoice number. This is the self-serve version of the same state change.
 *
 * ## The signature format
 *
 * Header `x-fngs-signature`, value `sha256_<hex>` — an underscore, not the
 * `sha256=` that GitHub popularised and that a first pass here assumed. A bare
 * `<hex>` is also accepted, because the prefix was added in a silent change
 * once already on another integration; the two forms are the same HMAC and
 * accepting both costs nothing, since every branch still requires the secret.
 *
 * ## What the webhook must prove
 *
 * The signature proves the body came from them. It does NOT prove the money is
 * real — so the route re-fetches the order over the authenticated API and
 * requires `status === "PAID"` before anything is fulfilled. That also covers
 * their database lagging behind their webhook fanout.
 *
 * ## Not marked `server-only`, deliberately
 *
 * Its neighbours (`posthog-query.ts`, `admin.ts`) are. This one is not, so the
 * signature verification can be unit-tested — `server-only` throws on import
 * outside a server component, which includes vitest.
 *
 * That costs nothing here because the module holds no secret. The secret is a
 * PARAMETER of `verifyFungiesSignature`, and `fungiesConfig()` reads an
 * environment variable with no `NEXT_PUBLIC_` prefix, which is `undefined` in
 * a browser bundle. A client component importing this file would get `null`
 * back and learn nothing. Signature verification is also the one piece of this
 * integration where being wrong is silent and expensive, so it is the piece
 * that most needs tests.
 */

export type FungiesConfig = {
  secret: string;
  header: string;
  allowTest: boolean;
};

/** Null when the integration is not set up — every caller answers 503. */
export function fungiesConfig(): FungiesConfig | null {
  const secret = process.env.FUNGIES_WEBHOOK_SECRET;
  if (!secret) return null;
  return {
    secret,
    // A sensible default so a preview deploy works before the real name is
    // known. It is still read from the environment because it is a guess.
    header: process.env.FUNGIES_SIGNATURE_HEADER ?? "x-fngs-signature",
    allowTest: process.env.FUNGIES_ALLOW_TEST === "true",
  };
}

/** The hosted checkout URL for a package length, if one is configured. */
/**
 * The offer id for a package length.
 *
 * Checkout targets an OFFER, not a product. That distinction is not academic
 * here: the 7-day product still carries an abandoned $4,200 offer alongside
 * the real $42 one, and a product-level checkout URL resolves to the product
 * rather than a stated price. Both shapes return 200, so the wrong one fails
 * by charging the wrong amount rather than by erroring.
 */
export function offerIdFor(days: number): string | null {
  if (!(PACKAGES as readonly number[]).includes(days)) return null;
  return process.env[`FUNGIES_OFFER_${days}`] ?? null;
}

/**
 * The checkout ELEMENT id for a package length.
 *
 * An element is the same offer wrapped so the JS SDK can open it in an overlay
 * on our own page. See `campaignOverlayUrl` for why that matters.
 */
export function elementIdFor(days: number): string | null {
  if (!(PACKAGES as readonly number[]).includes(days)) return null;
  return process.env[`FUNGIES_ELEMENT_${days}`] ?? null;
}

/**
 * The URL the overlay loads, for a package length.
 *
 * ## Why an overlay rather than sending them to the store
 *
 * The plain hosted link hands the buyer to the provider's own page, and when
 * they finish paying it obeys the store's "Instant Redirect URL" — a single
 * setting for the whole account. That account is shared with another product,
 * so the first person to buy a listing paid and was delivered to somebody
 * else's website. There is no per-checkout redirect parameter; the setting is
 * the only lever, and it is not ours to move.
 *
 * An overlay removes the question. The payment happens in a frame on our page,
 * the SDK raises `fungies:checkout:complete` when it is done, and we decide
 * where the buyer goes next — which is their own listing.
 *
 * Returns null when no element is configured, and the caller falls back to the
 * hosted link. Being sent to the wrong thank-you page is worse than a polished
 * flow but much better than not being able to pay at all.
 */
export function campaignOverlayUrl(days: number): string | null {
  const slug = process.env.FUNGIES_STORE_SLUG;
  const elementId = elementIdFor(days);
  if (!slug || !elementId) return null;
  // `.app.` is load-bearing: `<slug>.fungies.io` does not resolve.
  return `https://${slug}.app.fungies.io/checkout-element/${elementId}`;
}

/**
 * The hosted checkout URL for one campaign.
 *
 * ## The host has `.app.` in it
 *
 * `https://<slug>.app.fungies.io/checkout/<offerId>`. The help pages read as
 * though it is `<slug>.fungies.io`, which does not resolve at all — I spent a
 * round of probing on that spelling and concluded no derivable URL existed,
 * which was wrong and would have left this on hand-copied dashboard links
 * forever.
 *
 * ## Why this is built here rather than stored per package
 *
 * Two callers send a buyer to payment — straight after submitting a listing,
 * and the Pay button on a campaign they return to. If each assembled the URL
 * itself, the parameter that eventually gets dropped is `campaign_id`, which
 * is how the webhook works out what was bought. A payment that arrives without
 * it lands in the manual queue.
 *
 * ## Both email spellings
 *
 * The published help documents `fngs-user-email`; a production integration on
 * another product uses `fngs-customer-email`. Sending both costs nothing, and
 * an unrecognised query parameter is ignored — whereas a buyer retyping their
 * address on the payment page is a step where people leave.
 */
export function campaignCheckoutUrl(
  days: number,
  campaignId: string,
  buyerEmail: string | null,
): string | null {
  const slug = process.env.FUNGIES_STORE_SLUG;
  const offerId = offerIdFor(days);
  if (!slug || !offerId) return null;

  try {
    const url = new URL(`https://${slug}.app.fungies.io/checkout/${offerId}`);
    if (buyerEmail) {
      url.searchParams.set("fngs-customer-email", buyerEmail);
      url.searchParams.set("fngs-user-email", buyerEmail);
    }
    // Comes back on the webhook, and is the primary way a payment is matched
    // to what it paid for.
    url.searchParams.set("campaign_id", campaignId);
    return url.toString();
  } catch {
    console.error("[fungies] could not build a checkout URL for", days, "days");
    return null;
  }
}

/**
 * Constant-time compare of two hex/base64 strings of possibly different length.
 *
 * `timingSafeEqual` throws when the buffers differ in length, and that throw is
 * itself a length oracle. Comparing the digest of each side removes both
 * problems: equal-length inputs, and no early exit.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "compare").update(a).digest();
  const hb = createHmac("sha256", "compare").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verify a webhook signature.
 *
 * HMAC-SHA256 over the RAW request body with the shared secret. The raw body
 * matters: `JSON.parse` then `JSON.stringify` reorders keys and drops
 * whitespace, so a re-serialised body will not match a signature computed over
 * what was actually sent. The route reads `request.text()` for this reason and
 * parses afterwards.
 *
 * Accepted forms: `sha256_<hex>`, a bare `<hex>`, and base64. All the same
 * HMAC; only the presentation differs. Being generous about encoding is not a
 * weakness — every branch still requires the secret — and the prefix has
 * changed silently before.
 */
export function verifyFungiesSignature(
  rawBody: string,
  headerValue: string | null,
  secret: string,
): boolean {
  if (!headerValue) return false;

  const mac = createHmac("sha256", secret).update(rawBody, "utf8");
  const hex = mac.digest("hex");
  const b64 = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  const candidate = headerValue.trim();
  /*
   * Strip a scheme prefix, whichever separator it uses.
   *
   * fungies sends `sha256_<hex>`. An earlier version here only split on `=`,
   * so the real format would have failed every signature check — silently,
   * as a 401 on every genuine payment.
   */
  const stripped = candidate
    .replace(/^sha256[_=]/i, "")
    .replace(/^.*[,=]/, "")
    .trim();

  return (
    safeEqual(candidate, hex) ||
    safeEqual(candidate, b64) ||
    safeEqual(stripped, hex) ||
    safeEqual(stripped, b64)
  );
}

export type FungiesEvent = {
  /** The provider's own id. Becomes the primary key of `payment_events`. */
  eventId: string;
  /** The ORDER id — what the authenticated re-fetch is keyed on. */
  orderId: string | null;
  type: string;
  /** True on an event generated by the dashboard's Test button. */
  testMode: boolean;
  /** From the product's Custom Field, when it survived the checkout. */
  campaignId: string | null;
  email: string | null;
  /** Overwritten by the route from the authenticated order, which is truth. */
  amount: number | null;
  currency: string | null;
  /**
   * What the line item costs before any discount, in major units.
   *
   * The order total is what was CHARGED; this is what was BOUGHT. They differ
   * whenever a discount code is used, and the shared store carries a 100% one
   * — so an order can legitimately arrive with a total of 0 for a $42 listing.
   * Matching a payment to a `pending_checkouts` row on the charged total would
   * miss every discounted purchase, which is the case most in need of being
   * matched automatically.
   */
  itemAmount: number | null;
  /** `data.items[].offer.id` — maps back to a package length. */
  offerId: string | null;
};

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

/**
 * Pull what we need out of a webhook body.
 *
 * Deliberately forgiving about shape. The payload is somebody else's schema,
 * it is documented loosely, and it will change without telling us — but the
 * five fields below are the only ones this system acts on, and each has an
 * obvious set of names it could arrive under. A field we cannot find comes
 * back null and the caller decides, rather than this throwing and turning a
 * recoverable payment into a 500 the provider retries forever.
 *
 * `eventId` is the exception: without it there is no idempotency key, and
 * processing an event that cannot be de-duplicated is worse than dropping it.
 */
export function parseFungiesEvent(body: unknown): FungiesEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const data = (b.data ?? b.object ?? b.payload ?? {}) as Record<string, unknown>;

  const eventId = pick(b, "idempotencyKey", "idempotency_key", "eventId", "event_id", "id");
  if (typeof eventId !== "string" || !eventId) return null;

  /*
   * Custom fields live on the LINE ITEM, not on `data`.
   *
   * The first real payload carried `data.items[0].customFields`, and this read
   * only `data.customFields` — so the campaign id it was looking for could
   * never have been found even if the checkout had carried one. Both are
   * searched now, item first, because that is where the provider actually
   * puts it.
   */
  const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  const itemCustom = items.reduce<Record<string, unknown>>(
    (acc, item) => ({
      ...acc,
      ...((item.customFields ?? item.custom_fields ?? {}) as Record<string, unknown>),
    }),
    {},
  );
  const custom = {
    ...((data.customFields ?? data.custom_fields ?? b.customFields ?? {}) as Record<
      string,
      unknown
    >),
    ...itemCustom,
  };

  const rawAmount = pick(data, "amount", "total", "value") ?? pick(b, "amount", "total");
  const amount =
    typeof rawAmount === "number"
      ? rawAmount
      : typeof rawAmount === "string" && rawAmount.trim() !== ""
        ? Number(rawAmount)
        : null;

  /*
   * The line item, in major units.
   *
   * `value` is minor units and `currencyDecimals` sits on the order, not the
   * item — so the divisor is read from the order and defaults to 2.
   */
  const orderObj = (data.order ?? b.order ?? {}) as Record<string, unknown>;
  const decimals =
    typeof orderObj.currencyDecimals === "number" ? orderObj.currencyDecimals : 2;
  const rawItem = items.length ? pick(items[0], "value", "price", "amount") : null;
  const itemAmount =
    typeof rawItem === "number" && Number.isFinite(rawItem) ? rawItem / 10 ** decimals : null;

  const offer = (items[0]?.offer ?? {}) as Record<string, unknown>;
  const offerId = (pick(offer, "id") as string | null) ?? null;

  /*
   * `livemode` is the INVERSE of test mode, and lumping it in with the
   * `testMode` aliases would read a live payment as a test one and refuse to
   * process it. Handled separately for that reason.
   */
  const explicitTest = b.testMode === true || b.test_mode === true;
  const liveFlag = b.livemode ?? b.liveMode;
  const testMode = explicitTest || liveFlag === false;

  /*
   * The ORDER id, not the payment id.
   *
   * They are different resource namespaces: a payment id 404s on the order
   * endpoint. The order is what carries `status: "PAID"`, which is the thing
   * worth checking before anything is fulfilled.
   */
  const orderId =
    (pick(orderObj, "id", "number") as string | null) ??
    (pick(data, "orderId", "order_id") as string | null);

  return {
    eventId,
    orderId,
    type: String(pick(b, "type", "event", "eventType") ?? "unknown"),
    testMode,
    campaignId:
      (pick(custom, "campaign_id", "campaignId") as string | null) ??
      (pick(data, "campaign_id", "campaignId") as string | null),
    /*
     * The buyer's address is NESTED, under `data.customer` and `data.user`.
     *
     * This looked for `data.email` and a few spellings of it, all at the top
     * level, and the real payload has none of them — so every event parsed
     * with a null email, and the `pending_checkouts` fallback that matches on
     * email could never run. A payment arrived, matched nothing, and sat in
     * the admin queue; the fallback built precisely for that case was
     * unreachable.
     */
    email:
      (pick(
        (data.customer ?? {}) as Record<string, unknown>,
        "email",
        "userEmail",
        "user_email",
      ) as string | null) ??
      (pick((data.user ?? {}) as Record<string, unknown>, "email") as string | null) ??
      (pick(data, "email", "userEmail", "user_email", "customerEmail") as string | null) ??
      null,
    amount: Number.isFinite(amount as number) ? (amount as number) : null,
    currency:
      (pick(data, "currency", "currencyCode") as string | null) ??
      (pick(orderObj, "currency", "currencyCode") as string | null) ??
      null,
    itemAmount,
    offerId,
  };
}

/**
 * An address reduced to what identifies the mailbox, for MATCHING only.
 *
 * Lowercased, and any `+tag` removed from the local part. Never stored, never
 * shown, never used to send anything — a normalised address is a key, not a
 * destination, and `office+2@…` and `office@…` are different inboxes to a mail
 * server even though they are the same person to a payment provider.
 *
 * This exists because a payment arrived and matched nothing. The recruiter's
 * account was `office+2@example.com`; the provider reported the buyer as
 * `office@example.com`, because the card account is held under the base
 * address. Exact equality failed, the listing stayed on "waiting for payment"
 * after a success screen, and the money sat unattached.
 *
 * Dots are deliberately NOT stripped. Gmail ignores them, almost nobody else
 * does, and collapsing `a.b@` into `ab@` would merge genuinely separate
 * mailboxes at every other provider — a worse failure than the one being
 * fixed, because it would attach a payment to the wrong campaign.
 */
export function normaliseEmailForMatch(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return null;
  const local = trimmed.slice(0, at).split("+")[0];
  const domain = trimmed.slice(at + 1);
  if (!local || !domain) return null;
  return `${local}@${domain}`;
}

/** Our three event types, mapped off whatever the provider calls them. */
export function classifyEvent(type: string): "paid" | "refunded" | "failed" | "other" {
  const t = type.toLowerCase();
  if (t.includes("refund")) return "refunded";
  if (t.includes("fail") || t.includes("declin")) return "failed";
  if (t.includes("success") || t.includes("paid") || t.includes("complete")) return "paid";
  return "other";
}

/* ------------------------------------------------------------------------- */
/* Reading back from the API                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Cloudflare sits in front of the API and rejects unknown user-agents with a
 * 403 carrying "error code: 1010" — which reads exactly like a rejected key.
 * Node's fetch sends its own agent, so one is set explicitly.
 */
const API_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export type FungiesOrder = {
  id: string;
  number?: string | null;
  status?: string | null;
  /** Smallest unit — cents for USD. Not the same units the offer was created in. */
  value?: number | null;
  tax?: number | null;
  fee?: number | null;
  currency?: string | null;
  currencyDecimals?: number | null;
  user?: { id?: string | null; email?: string | null } | null;
};

/**
 * Fetch one order, authenticated.
 *
 * Responses are enveloped and then wrapped again by resource name, so a single
 * order arrives as `{ data: { order: {...} } }`. Unwrapped defensively because
 * the shape has moved before.
 *
 * Returns null on any failure, including a network one. The caller treats that
 * as retryable rather than as "not paid" — the difference between "we could
 * not check" and "we checked and it was not paid" is the difference between
 * retrying and silently dropping somebody's payment.
 */
export async function fetchFungiesOrder(orderId: string): Promise<FungiesOrder | null> {
  const pub = process.env.FUNGIES_KEY;
  const sec = process.env.FUNGIES_SECRET;
  if (!pub || !sec) return null;

  try {
    const res = await fetch(`https://api.fungies.io/v0/orders/${encodeURIComponent(orderId)}`, {
      headers: {
        "x-fngs-public-key": pub,
        "x-fngs-secret-key": sec,
        Accept: "application/json",
        "User-Agent": API_UA,
      },
      // The API is occasionally slow rather than down.
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[fungies] order ${orderId} -> ${res.status}`);
      return null;
    }
    const json = (await res.json()) as Record<string, unknown>;
    const data = (json.data ?? json) as Record<string, unknown>;
    return ((data.order ?? data) as FungiesOrder) ?? null;
  } catch (err) {
    console.error("[fungies] order fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Money off an order, in major units.
 *
 * Everything coming back from the API is in the smallest unit, and
 * `currencyDecimals` says how many there are — 2 for dollars, 0 for yen. Using
 * a hardcoded /100 works until the first zero-decimal currency and then
 * overstates a charge by a hundred times.
 */
export function orderAmountMajor(order: FungiesOrder): number | null {
  if (order.value == null) return null;
  const decimals = order.currencyDecimals ?? 2;
  return order.value / 10 ** decimals;
}
