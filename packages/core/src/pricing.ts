/**
 * What a sponsored listing costs.
 *
 * ## Dollars are the money; shekels are the translation
 *
 * The payment provider settles in USD — every offer in the fungies account is
 * USD, and the buyers are Israeli businesses who will read a shekel figure. So
 * the price is defined in dollars, stored in dollars and charged in dollars,
 * and the shekel figure beside it is a conversion shown for readability.
 *
 * This is the way round that stays honest. Defining the price in shekels and
 * converting at checkout would mean the number on the page and the number on
 * the card statement drift apart every time the rate moves, and the buyer
 * would be right to call that a bait price.
 *
 * ## The rule, in one line
 *
 * $6 a day, and each extra week costs 10% less than the week before it.
 *
 * A *marginal* discount, not an average one: buying 14 days does not make all
 * 14 days cheaper, it makes the second seven cheaper. Week one is 7 × $6 = $42,
 * and each week after is 10% off the one before.
 *
 * | days | total | per day | ≈ shekels |
 * |------|-------|---------|-----------|
 * | 7    | $42   | $6.00   | ₪134      |
 * | 14   | $80   | $5.71   | ₪256      |
 * | 21   | $114  | $5.43   | ₪365      |
 * | 28   | $145  | $5.18   | ₪464      |
 *
 * The discount stops at four weeks because a listing older than a month is not
 * one anybody should be paying to show — the site marks postings over 60 days
 * old as stale in as many words.
 *
 * ## Why $6 and not $5.94
 *
 * The previous rate was ₪19/day. At 3.2 that is $5.94, and a price list of
 * $41.56 / $79.06 / $112.81 is not a price list. Rounding the DAY rate to $6
 * makes every figure downstream a whole number, and lands within twenty agorot
 * of where the shekel price started: ₪19.20 a day against ₪19.
 *
 * ## Why this lives in two places
 *
 * There is a twin of this function in SQL (`price_usd(int)`, 0045), because the
 * price a campaign is charged has to be computable inside the database where
 * the campaign row is written, and the price the buyer is *shown* has to be
 * computable in the browser before any row exists. Both round exactly once, at
 * the end, and the migration carries assertions checking it agrees with the
 * table above.
 */

/** The headline rate, in dollars. Everything else is derived from it. */
export const DAY_RATE_USD = 6;

/**
 * What each successive week costs in total: full price, then 10% off the
 * previous week, three times, rounded to whole dollars.
 *
 *   42 → 37.8 → 34.02 → 30.62, rounded to 42 / 38 / 34 / 31.
 */
export const WEEK_TOTALS_USD = [42, 38, 34, 31] as const;

/**
 * Shekels per dollar, for display only.
 *
 * A fixed rate, deliberately. A live rate would make the shekel figure on the
 * pricing page differ from the one on the listing a week later, for a number
 * that exists purely to help an Israeli reader size the cost. Nothing is ever
 * charged in shekels, so nothing depends on this being current — and a fixed
 * number is one nobody has to check.
 */
export const ILS_PER_USD = 3.2;

/** What self-serve sells. Anything else is an invoice. */
export const PACKAGES = [7, 14, 21, 28] as const;

export const MAX_DAYS = 28;

export interface PriceBreakdown {
  days: number;
  /** Total in dollars. This is what is charged. */
  totalUsd: number;
  /** Total ÷ days, to two decimals. Display only — never charge this × days. */
  perDayUsd: number;
  /** The same total in shekels, for display. Never charged. */
  totalIls: number;
  /** What the buyer saves against 28 × $6. Zero for a single week. */
  savedUsd: number;
  /** Per-week totals actually used, in order. */
  weeks: number[];
}

/**
 * The price of `days` days, in whole dollars.
 *
 * Whole weeks are charged at their own week's total; a partial final week is
 * pro-rated at *that* week's day rate, not at the headline rate — buying 10
 * days should not cost more per day for days 8-10 than buying 14 does.
 *
 * Throws outside 1..28. A caller asking for 0 or 400 days has a bug, and
 * silently clamping it would put a wrong number in front of a paying customer.
 */
export function priceUsd(days: number): number {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new RangeError(`days must be a whole number in 1..${MAX_DAYS}, got ${days}`);
  }

  let total = 0;
  let remaining = days;
  for (const weekTotal of WEEK_TOTALS_USD) {
    if (remaining <= 0) break;
    const inThisWeek = Math.min(7, remaining);
    total += inThisWeek === 7 ? weekTotal : (weekTotal * inThisWeek) / 7;
    remaining -= inThisWeek;
  }
  // One rounding, at the very end. Rounding each week would drift.
  return Math.round(total);
}

/** Total ÷ days, to two decimals. For display beside the package price. */
export function pricePerDayUsd(days: number): number {
  return Math.round((priceUsd(days) / days) * 100) / 100;
}

/** The dollar price rendered in shekels, for display only. */
export function usdToIls(usd: number): number {
  return Math.round(usd * ILS_PER_USD);
}

/** What the payment provider wants: an integer count of cents. */
export function usdToCents(usd: number): number {
  return Math.round(usd * 100);
}

export function priceBreakdown(days: number): PriceBreakdown {
  const totalUsd = priceUsd(days);
  const weeks: number[] = [];
  let remaining = days;
  for (const weekTotal of WEEK_TOTALS_USD) {
    if (remaining <= 0) break;
    const inThisWeek = Math.min(7, remaining);
    weeks.push(Math.round(inThisWeek === 7 ? weekTotal : (weekTotal * inThisWeek) / 7));
    remaining -= inThisWeek;
  }
  return {
    days,
    totalUsd,
    perDayUsd: pricePerDayUsd(days),
    totalIls: usdToIls(totalUsd),
    savedUsd: days * DAY_RATE_USD - totalUsd,
    weeks,
  };
}

/** True when `days` is one of the four packages self-serve checkout sells. */
export function isPackage(days: number): days is (typeof PACKAGES)[number] {
  return (PACKAGES as readonly number[]).includes(days);
}

/* ------------------------------------------------------------------------- */
/* The free tier                                                              */
/* ------------------------------------------------------------------------- */

/**
 * How long a free listing stays open.
 *
 * Seven days, and it closes itself. This is the ghost-job defence, and it is
 * the reason a free tier can exist at all: the thing that makes free job
 * boards useless is not that posting is free, it is that nothing ever comes
 * down. A listing that expires in a week is either re-posted by somebody who
 * still wants the applications, or it is gone — and either way the reader is
 * told the truth.
 *
 * Wanting longer is a real want, and it is what the paid tier sells. That is a
 * deliberately honest upsell: you are not paying to remove a restriction we
 * invented, you are paying for the thing the restriction costs you.
 */
export const FREE_DAYS = 7;

/** Every length the posting form offers, free first. */
export const LIFESPAN_OPTIONS = [
  { days: FREE_DAYS, plan: "free" as const },
  ...PACKAGES.map((days) => ({ days, plan: "sponsored" as const })),
];

export type PostingPlan = "free" | "sponsored";

/**
 * What a listing costs, given both choices.
 *
 * Free is free and lasts a week, organic only. Paid buys BOTH a longer life
 * and the labelled sponsored slot — one product, not two, because splitting
 * "longer" from "promoted" into separate prices would produce four
 * combinations to explain and nobody asked for the other two.
 */
export function planPriceUsd(plan: PostingPlan, days: number): number {
  if (plan === "free") return 0;
  return priceUsd(days);
}
