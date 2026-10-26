/**
 * Create and reconcile the Jobsworm products in fungies.
 *
 *     pnpm fungies:sync            # report what it would do
 *     pnpm fungies:sync --apply    # create what is missing
 *
 * ## The account may be shared
 *
 * A fungies account can sell several unrelated products, and theirs carry
 * live orders. Nothing here writes to anything it did not
 * create: products are matched by name, and a product whose name does not
 * begin "Jobsworm" is somebody else's and is never touched — not even to fix a
 * typo. The script has no update or delete path at all, so the worst it can do
 * to a neighbouring product is nothing.
 *
 * ## Four gotchas, all discovered the hard way against the live API
 *
 * 1. **Cloudflare blocks a default user-agent.** A request without a
 *    browser-like `User-Agent` comes back 403 with "error code: 1010", which
 *    reads exactly like a rejected API key and is not. Node's fetch sends its
 *    own agent, so one is set explicitly on every call.
 * 2. **`price` is in MAJOR units, and the API multiplies.** Sending `4200` for
 *    $42 created an offer stored as 420000 minor units — a $4,200 product.
 *    Send `42`. The list endpoint returns MINOR units, so a round trip is not
 *    symmetric, which is exactly why this reads back and checks.
 * 3. **`internalId` is silently dropped on create.** It comes back null, so it
 *    cannot be an idempotency key. Matching is by product NAME, which this
 *    script owns and which is distinctive enough to be safe.
 * 4. **There is no update, archive or delete endpoint** for products or
 *    offers — only create and list. A wrong price cannot be corrected here; it
 *    has to be archived in the dashboard by hand. That is the single best
 *    reason to run the report before applying.
 *
 * ## Why products are created by script rather than by hand
 *
 * Four packages, each with a price that is derived from `priceUsd()`. Typing
 * those into a dashboard is four chances to disagree with the pricing module,
 * and nothing would catch it — the buyer would simply be charged a different
 * number from the one the page showed them. This reads the prices from the
 * same function the page does.
 */

import { config as loadEnv } from "dotenv";
import { PACKAGES, priceUsd, pricePerDayUsd, usdToCents, usdToIls } from "@jobsworm/core";

loadEnv({ path: ".env.local" });

const API = "https://api.fungies.io/v0";

/**
 * Cloudflare in front of the API rejects unknown agents with a 1010 that looks
 * like an auth failure. See the header.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const APPLY = process.argv.includes("--apply");

/*
 * Ownership is decided by the product NAME.
 *
 * `internalId` would be the right key and the API accepts it on create and
 * then stores null, so it is useless for this. The name is ours, it is
 * distinctive, and nothing in the shared account comes close to it.
 */
const NAME_PREFIX = "Jobsworm";
const productNameFor = (days: number) => `${NAME_PREFIX} — sponsored listing, ${days} days`;
const offerNameFor = (days: number) => `${days} days`;

/*
 * A checkout ELEMENT per package, on top of the product and its offer.
 *
 * An element is what the JS SDK opens in an overlay on our own page, and it is
 * the only way to keep a buyer on jobsworm.fun through the payment. A plain
 * `/checkout/<offerId>` link sends them to the store's own page, and when that
 * finishes it obeys the store-level "Instant Redirect URL" — one setting for
 * the whole account. On a shared account that URL belongs to another product,
 * so a buyer who paid for a listing lands on someone else's site.
 *
 * With an overlay there is nothing to redirect: the SDK raises
 * `fungies:checkout:complete` on our own page and we choose where to go.
 *
 * "<product name> overlay" keeps elements recognisable next to other products'
 * elements in a shared account.
 */
const elementNameFor = (days: number) => `${productNameFor(days)} overlay`;

function creds(): { pub: string; sec: string } {
  const pub = process.env.FUNGIES_KEY;
  const sec = process.env.FUNGIES_SECRET;
  if (!pub || !sec) {
    console.error("Set FUNGIES_KEY and FUNGIES_SECRET in .env.local.");
    process.exit(1);
  }
  return { pub, sec };
}

async function call<T = unknown>(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<T> {
  const { pub, sec } = creds();
  const res = await fetch(API + path, {
    method,
    headers: {
      "x-fngs-public-key": pub,
      "x-fngs-secret-key": sec,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

type Product = { id: string; name: string; internalId: string | null; status: string };
type CheckoutElement = {
  id: string;
  name: string;
  status: string;
  offers: { id: string }[];
};
type Offer = {
  id: string;
  internalId: string | null;
  price: number;
  currency: string;
  name: string;
  status: string;
};

function describe(days: number): { name: string; description: string } {
  const usd = priceUsd(days);
  return {
    name: productNameFor(days),
    description:
      `A labelled sponsored slot on Jobsworm for ${days} days: your listing appears in the ` +
      `Sponsored strip on the home page and above matching search results, with the price ` +
      `paid shown on the card. $${usd} (about ₪${usdToIls(usd)}), $${pricePerDayUsd(days)} a day. ` +
      `Sponsored placement never changes the order of organic search results.`,
  };
}

async function main() {
  console.log(`\n  ${APPLY ? "APPLYING" : "REPORT ONLY"} — fungies product sync\n`);

  const products = (await call<{ data: { products: Product[] } }>("/products/list")).data.products;
  const offers = (await call<{ data: { offers: Offer[] } }>("/offers/list")).data.offers;

  const ours = products.filter((p) => p.name.startsWith(NAME_PREFIX));
  console.log(
    `  ${products.length} products in the account, ${ours.length} of them Jobsworm's.`,
  );
  console.log(`  ${products.length - ours.length} belong to other projects and are left alone.\n`);

  for (const days of PACKAGES) {
    const usd = priceUsd(days);
    // MAJOR units on the way in; the list endpoint hands back MINOR units.
    const expectedMinor = usdToCents(usd);
    const existingProduct = products.find((p) => p.name === productNameFor(days));
    const productOffers = offers.filter((o) => o.name === offerNameFor(days));
    const correct = productOffers.find((o) => o.price === expectedMinor && o.currency === "USD");
    const wrong = productOffers.filter((o) => o.price !== expectedMinor || o.currency !== "USD");

    for (const o of wrong) {
      console.log(
        `  ${days}d  WRONG PRICE  offer ${o.id}  ${o.currency} ` +
          `${(o.price / 100).toFixed(2)} — expected USD ${usd}.00. ` +
          `Archive it in the dashboard; the API cannot.`,
      );
    }

    if (existingProduct && correct) {
      console.log(`  ${days}d  ok  product=${existingProduct.id.slice(0, 8)} offer=${correct.id.slice(0, 8)}  USD ${usd}.00`);
      continue;
    }

    if (!APPLY) {
      if (!existingProduct) console.log(`  ${days}d  would create product "${productNameFor(days)}"`);
      if (!correct) console.log(`  ${days}d  would create offer    USD ${usd}.00`);
      continue;
    }

    let productId = existingProduct?.id;
    if (!productId) {
      const { name, description } = describe(days);
      const created = await call<{ data: { product: Product } }>("/products/create", "POST", {
        name,
        description,
        type: "OneTimePayment",
      });
      productId = created.data.product.id;
      console.log(`  ${days}d  created product ${productId.slice(0, 8)}`);
    }

    if (!correct) {
      const offer = await call<{ data: { offer: Offer } }>("/offers/create", "POST", {
        productId,
        // MAJOR units. Sending cents here created a $4,200 offer once.
        price: usd,
        currency: "USD",
        limit: null,
        name: offerNameFor(days),
      });
      console.log(`  ${days}d  created offer   ${offer.data.offer.id.slice(0, 8)}  USD ${usd}.00`);
    }
  }

  /* ---- checkout elements, one per package ------------------------------ */
  console.log("");
  const elements = (
    await call<{ data: { checkoutElements: CheckoutElement[] } }>("/elements/checkout/list")
  ).data.checkoutElements;
  const theirs = elements.filter((e) => !e.name.startsWith(NAME_PREFIX));
  console.log(
    `  ${elements.length} checkout elements, ${theirs.length} belonging to other projects.`,
  );

  const envLines: string[] = [];
  for (const days of PACKAGES) {
    const expectedMinor = usdToCents(priceUsd(days));
    const offer = offers.find(
      (o) => o.name === offerNameFor(days) && o.price === expectedMinor && o.currency === "USD",
    );
    if (!offer) {
      console.log(`  ${days}d  no correctly priced offer yet — run with --apply first.`);
      continue;
    }

    /*
     * Matched on the OFFER it sells, not on its name.
     *
     * A name is ours to choose and could be typed twice; the offer is the
     * thing that must not end up with two elements pointing at it. There is no
     * delete endpoint, so a duplicate created here would be permanent.
     */
    const existing = elements.find(
      (e) => e.name.startsWith(NAME_PREFIX) && e.offers.some((o) => o.id === offer.id),
    );
    if (existing) {
      console.log(`  ${days}d  ok  element=${existing.id.slice(0, 8)}  ${existing.status}`);
      envLines.push(`FUNGIES_ELEMENT_${days}=${existing.id}`);
      continue;
    }
    if (!APPLY) {
      console.log(`  ${days}d  would create element "${elementNameFor(days)}"`);
      continue;
    }
    const created = await call<{ data: { checkoutElement: CheckoutElement } }>(
      "/elements/checkout/create",
      "POST",
      // `offersIds`, with the s in that position. Not a typo here.
      { name: elementNameFor(days), offersIds: [offer.id] },
    );
    const id = created.data.checkoutElement.id;
    console.log(`  ${days}d  created element ${id.slice(0, 8)}`);
    envLines.push(`FUNGIES_ELEMENT_${days}=${id}`);
  }

  if (envLines.length) {
    console.log("\n\n  Environment (.env.local and Vercel):\n");
    for (const line of envLines) console.log(`    ${line}`);
  }

  if (!APPLY) console.log("\n  Report only. Pass --apply to create.\n");
  else console.log(
      "\n  Done. The overlay also needs this site's origins on the authorized-domains" +
        "\n  list: Dashboard -> Settings -> Store -> Checkout. Without them the" +
        "\n  checkout frame opens blank.\n",
    );
}

main().catch((err) => {
  console.error("\n ", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
