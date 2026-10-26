import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  classifyEvent,
  normaliseEmailForMatch,
  parseFungiesEvent,
  verifyFungiesSignature,
} from "./fungies";

const SECRET = "a-long-random-webhook-secret";
const BODY = JSON.stringify({
  type: "payment_success",
  idempotencyKey: "evt_abc123",
  data: { orderId: "ord_1", amount: 253, currency: "ILS" },
});

const hex = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body, "utf8").digest("hex");
const b64 = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body, "utf8").digest("base64");

describe("verifyFungiesSignature", () => {
  it("accepts a hex digest", () => {
    expect(verifyFungiesSignature(BODY, hex(BODY), SECRET)).toBe(true);
  });

  it("accepts a base64 digest", () => {
    expect(verifyFungiesSignature(BODY, b64(BODY), SECRET)).toBe(true);
  });

  it("accepts the sha256_<hex> form fungies actually sends", () => {
    // Underscore, not the `sha256=` GitHub popularised. An earlier version here
    // only split on `=`, which would have rejected every genuine payment with
    // a 401 and looked exactly like a wrong secret.
    expect(verifyFungiesSignature(BODY, `sha256_${hex(BODY)}`, SECRET)).toBe(true);
  });

  it("still accepts the sha256=<hex> form", () => {
    expect(verifyFungiesSignature(BODY, `sha256=${hex(BODY)}`, SECRET)).toBe(true);
  });

  it("accepts a t=…,v1=… composite header", () => {
    expect(verifyFungiesSignature(BODY, `t=1699999999,v1=${hex(BODY)}`, SECRET)).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(verifyFungiesSignature(BODY, `  ${hex(BODY)}  `, SECRET)).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifyFungiesSignature(BODY, hex(BODY, "not-the-secret"), SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    // The payment amount changed after signing: the exact attack this stops.
    const signature = hex(BODY);
    const tampered = BODY.replace('"amount":253', '"amount":1');
    expect(verifyFungiesSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a missing or empty header", () => {
    expect(verifyFungiesSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyFungiesSignature(BODY, "", SECRET)).toBe(false);
  });

  it("rejects nonsense rather than throwing", () => {
    // timingSafeEqual throws on length mismatch, which would turn a garbage
    // header into a 500 the provider retries forever. It must return false.
    expect(verifyFungiesSignature(BODY, "x", SECRET)).toBe(false);
    expect(verifyFungiesSignature(BODY, "=".repeat(500), SECRET)).toBe(false);
  });

  it("is sensitive to whitespace in the body, which is why the raw body is used", () => {
    // JSON.parse -> JSON.stringify would produce this and break verification.
    const reserialised = JSON.stringify(JSON.parse(BODY.replace("{", "{ ")));
    const signature = hex(BODY.replace("{", "{ "));
    expect(verifyFungiesSignature(reserialised, signature, SECRET)).toBe(false);
  });
});

describe("parseFungiesEvent", () => {
  it("reads the five fields this system acts on", () => {
    const event = parseFungiesEvent({
      type: "payment_success",
      idempotencyKey: "evt_1",
      data: {
        orderId: "ord_9",
        amount: 253,
        currency: "ILS",
        email: "hr@acme.co.il",
        customFields: { campaign_id: "11111111-1111-1111-1111-111111111111" },
      },
    });
    expect(event).toMatchObject({
      eventId: "evt_1",
      type: "payment_success",
      orderId: "ord_9",
      amount: 253,
      currency: "ILS",
      email: "hr@acme.co.il",
      campaignId: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("refuses an event with no idempotency key", () => {
    // Without one there is no de-duplication, and a payment processed twice is
    // worse than one dropped and chased by hand.
    expect(parseFungiesEvent({ type: "payment_success", data: {} })).toBeNull();
  });

  it("survives a payload with none of the optional fields", () => {
    const event = parseFungiesEvent({ id: "evt_2" });
    expect(event).toMatchObject({ eventId: "evt_2", campaignId: null, amount: null });
  });

  it("survives junk", () => {
    expect(parseFungiesEvent(null)).toBeNull();
    expect(parseFungiesEvent("nope")).toBeNull();
    expect(parseFungiesEvent(42)).toBeNull();
  });

  it("reads an amount sent as a string", () => {
    expect(parseFungiesEvent({ id: "e", data: { amount: "253" } })?.amount).toBe(253);
    expect(parseFungiesEvent({ id: "e", data: { amount: "" } })?.amount).toBeNull();
  });

  it("treats livemode:false as test mode, and livemode:true as live", () => {
    // `livemode` is the inverse of `testMode`. Reading it as an alias would
    // make every real payment look like a test and refuse to process it.
    expect(parseFungiesEvent({ id: "e", livemode: false })?.testMode).toBe(true);
    expect(parseFungiesEvent({ id: "e", livemode: true })?.testMode).toBe(false);
    expect(parseFungiesEvent({ id: "e", testMode: true })?.testMode).toBe(true);
    expect(parseFungiesEvent({ id: "e" })?.testMode).toBe(false);
  });
});

describe("classifyEvent", () => {
  it("maps the provider's names onto ours", () => {
    expect(classifyEvent("payment_success")).toBe("paid");
    expect(classifyEvent("order.completed")).toBe("paid");
    expect(classifyEvent("payment_refunded")).toBe("refunded");
    expect(classifyEvent("payment_failed")).toBe("failed");
    expect(classifyEvent("card_declined")).toBe("failed");
    expect(classifyEvent("subscription_created")).toBe("other");
  });

  it("puts a partial refund on the refund path, not the payment one", () => {
    // "refund_succeeded" contains both "refund" and "succeed". Refund wins,
    // and it is checked first for exactly this reason.
    expect(classifyEvent("refund_succeeded")).toBe("refunded");
  });
});

describe("the order id", () => {
  it("is taken from data.order, not from the payment", () => {
    // Different resource namespaces: a payment id 404s on the order endpoint,
    // and the order is what carries status PAID.
    const e = parseFungiesEvent({
      id: "evt_1",
      type: "payment_success",
      data: { id: "pay_zzz", order: { id: "ord_9", number: "MT123" } },
    });
    expect(e?.orderId).toBe("ord_9");
  });

  it("falls back to the order number when there is no id", () => {
    const e = parseFungiesEvent({ id: "evt_1", data: { order: { number: "MT123" } } });
    expect(e?.orderId).toBe("MT123");
  });

  it("is null rather than wrong when the payload carries no order", () => {
    expect(parseFungiesEvent({ id: "evt_1", data: {} })?.orderId).toBeNull();
  });
});

/*
 * The shape of a real payment_success body.
 *
 * Copied from the first live purchase, with the buyer's identifiers replaced.
 * Every field the parser reads used to be looked for in the wrong place, and
 * nothing caught it because every earlier test invented its own flat payload
 * and then confirmed the parser could read it. A fixture that agrees with the
 * code it is testing proves nothing; this one comes from the provider.
 */
const LIVE_BODY = {
  id: "evt_live_1",
  type: "payment_success",
  testMode: false,
  idempotencyKey: "evt_live_1",
  data: {
    user: { id: "u_1", email: "buyer@example.com", object: "user" },
    customer: { id: "u_1", email: "buyer@example.com", object: "user" },
    items: [
      {
        id: "item_1",
        name: "7 days",
        value: 4200,
        object: "item",
        currency: "USD",
        quantity: 1,
        offer: { id: "offer_7", object: "offer", internalId: null },
        product: { id: "prod_7", object: "product", internalId: null },
        customFields: { campaign_id: "camp-7" },
      },
    ],
    order: {
      id: "ord_live",
      value: 0,
      number: "MTWW7YBMy9hjrdZ9",
      object: "order",
      status: "PAID",
      currency: "USD",
      currencyDecimals: 2,
    },
    payment: {
      id: "ord_live",
      value: 0,
      type: "claim_free",
      status: "PAID",
      discount: { name: "design partners", amount: 100, amountType: "percentage" },
    },
  },
};

describe("parseFungiesEvent on a real payload", () => {
  it("finds the buyer's email, which is nested under customer", () => {
    // It was read as `data.email`, which does not exist — so every event
    // parsed with a null email and the fallback that matches a payment to a
    // pending checkout by email could never run.
    expect(parseFungiesEvent(LIVE_BODY)?.email).toBe("buyer@example.com");
  });

  it("falls back to data.user.email when there is no customer", () => {
    const body = { ...LIVE_BODY, data: { ...LIVE_BODY.data, customer: undefined } };
    expect(parseFungiesEvent(body)?.email).toBe("buyer@example.com");
  });

  it("finds a custom field on the line item, not just on data", () => {
    expect(parseFungiesEvent(LIVE_BODY)?.campaignId).toBe("camp-7");
  });

  it("reads the line-item price in major units", () => {
    // 4200 minor units at currencyDecimals 2 is $42 — the price of the
    // listing, regardless of what the discounted order total came to.
    expect(parseFungiesEvent(LIVE_BODY)?.itemAmount).toBe(42);
  });

  it("keeps the item price separate from the discounted order total", () => {
    // A 100% discount code makes these two different numbers. Matching on the
    // charged total would miss every discounted purchase.
    const event = parseFungiesEvent(LIVE_BODY);
    expect(event?.itemAmount).toBe(42);
    expect(event?.amount).not.toBe(42);
  });

  it("carries the offer id, so a payment can be traced to a package", () => {
    expect(parseFungiesEvent(LIVE_BODY)?.offerId).toBe("offer_7");
  });

  it("reads the currency off the order when data has none", () => {
    expect(parseFungiesEvent(LIVE_BODY)?.currency).toBe("USD");
  });

  it("still takes the order id from data.order", () => {
    expect(parseFungiesEvent(LIVE_BODY)?.orderId).toBe("ord_live");
  });

  it("treats a live payload as live", () => {
    expect(parseFungiesEvent(LIVE_BODY)?.testMode).toBe(false);
  });

  it("survives a payload with no items at all", () => {
    const body = { ...LIVE_BODY, data: { ...LIVE_BODY.data, items: undefined } };
    const event = parseFungiesEvent(body);
    expect(event?.itemAmount).toBeNull();
    expect(event?.offerId).toBeNull();
    expect(event?.email).toBe("buyer@example.com");
  });
});

describe("normaliseEmailForMatch", () => {
  it("strips a plus tag, which is the bug that lost a real payment", () => {
    // The recruiter account was office+2@…; the provider reported the card
    // account as office@…. Exact equality failed and the listing stayed on
    // "waiting for payment" behind a success screen.
    expect(normaliseEmailForMatch("office+2@example.com")).toBe("office@example.com");
    expect(normaliseEmailForMatch("office@example.com")).toBe("office@example.com");
  });

  it("lowercases and trims", () => {
    expect(normaliseEmailForMatch("  Office+Tag@Example.COM ")).toBe("office@example.com");
  });

  it("keeps dots, because only Gmail ignores them", () => {
    /*
     * Collapsing a.b@ into ab@ would merge genuinely separate mailboxes
     * everywhere except Gmail — and merging them would attach a payment to the
     * wrong campaign, which is worse than leaving it unattached.
     */
    expect(normaliseEmailForMatch("a.b@example.com")).toBe("a.b@example.com");
    expect(normaliseEmailForMatch("a.b@example.com")).not.toBe(
      normaliseEmailForMatch("ab@example.com"),
    );
  });

  it("does not merge different domains or different mailboxes", () => {
    expect(normaliseEmailForMatch("office@a.com")).not.toBe(normaliseEmailForMatch("office@b.com"));
    expect(normaliseEmailForMatch("alice@x.com")).not.toBe(normaliseEmailForMatch("bob@x.com"));
  });

  it("is null for anything that is not an address", () => {
    for (const bad of [null, undefined, "", "   ", "no-at-sign", "@nolocal.com", "nodomain@"]) {
      expect(normaliseEmailForMatch(bad)).toBeNull();
    }
  });
});
