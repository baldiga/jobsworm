import { describe, expect, it } from "vitest";
import {
  DAY_RATE_USD,
  FREE_DAYS,
  ILS_PER_USD,
  LIFESPAN_OPTIONS,
  MAX_DAYS,
  PACKAGES,
  WEEK_TOTALS_USD,
  isPackage,
  planPriceUsd,
  priceBreakdown,
  priceUsd,
  pricePerDayUsd,
  usdToCents,
  usdToIls,
} from "./pricing";

describe("priceUsd", () => {
  it("prices the four packages exactly as advertised", () => {
    // These four numbers appear on the pricing page, in the SQL assertions, in
    // the fungies offers and on every receipt. If this fails, one of those is
    // now lying.
    expect(priceUsd(7)).toBe(42);
    expect(priceUsd(14)).toBe(80);
    expect(priceUsd(21)).toBe(114);
    expect(priceUsd(28)).toBe(145);
  });

  it("charges the headline rate inside the first week", () => {
    expect(priceUsd(1)).toBe(6);
    expect(priceUsd(3)).toBe(18);
    expect(priceUsd(6)).toBe(36);
  });

  it("pro-rates a partial week at that week's rate, not the headline rate", () => {
    // Days 8-10 fall in week two, which costs $38 for seven days.
    expect(priceUsd(10)).toBe(Math.round(42 + (38 * 3) / 7));
    expect(priceUsd(10)).toBe(58);
    // Not the naive 42 + 3 × 6 = 60.
    expect(priceUsd(10)).toBeLessThan(60);
  });

  it("never charges more for a longer campaign", () => {
    for (let d = 2; d <= MAX_DAYS; d++) {
      expect(priceUsd(d)).toBeGreaterThanOrEqual(priceUsd(d - 1));
    }
  });

  it("gets cheaper per day at every length self-serve actually sells", () => {
    for (let i = 1; i < PACKAGES.length; i++) {
      expect(pricePerDayUsd(PACKAGES[i]!)).toBeLessThan(pricePerDayUsd(PACKAGES[i - 1]!));
    }
    expect(pricePerDayUsd(7)).toBe(6);
    expect(pricePerDayUsd(28)).toBe(5.18);
  });

  it("is monotone across arbitrary day counts, to within rounding", () => {
    /*
     * Not strictly monotone, and that is rounding rather than pricing. The
     * underlying curve only ever falls, but the TOTAL is rounded to whole
     * dollars, so 9 days ($52.86 → $53) reads a cent dearer per day than 8
     * days ($47.43 → $47).
     *
     * Left as it is rather than pricing in cents: the four packages are what
     * self-serve sells and they are strictly decreasing, odd day counts go
     * through an invoice, and a price list of whole dollars is worth more than
     * a cent of theoretical smoothness.
     */
    // Compared in whole cents: `5.80 + 0.02` is 5.819999999999999 in binary
    // floating point, which is exactly the kind of comparison that makes a
    // money test flap.
    const cents = (d: number) => Math.round(pricePerDayUsd(d) * 100);
    for (let d = 2; d <= MAX_DAYS; d++) {
      expect(cents(d)).toBeLessThanOrEqual(cents(d - 1) + 2);
    }
  });

  it("keeps each week roughly a tenth cheaper than the last", () => {
    for (let i = 1; i < WEEK_TOTALS_USD.length; i++) {
      const ratio = WEEK_TOTALS_USD[i]! / WEEK_TOTALS_USD[i - 1]!;
      expect(ratio).toBeGreaterThan(0.88);
      expect(ratio).toBeLessThan(0.92);
    }
  });

  it("refuses anything outside 1..28", () => {
    expect(() => priceUsd(0)).toThrow(RangeError);
    expect(() => priceUsd(-3)).toThrow(RangeError);
    expect(() => priceUsd(29)).toThrow(RangeError);
    expect(() => priceUsd(7.5)).toThrow(RangeError);
    expect(() => priceUsd(Number.NaN)).toThrow(RangeError);
  });

  /*
   * The SQL twin in 0045 uses Postgres `round()`, which breaks a .5 tie away
   * from zero; JavaScript's Math.round breaks it upward. On positive numbers
   * those agree, but float noise on either side could still tip a tie, so the
   * safe claim is that no tie exists at all.
   */
  it("has no rounding tie anywhere in 1..28, so SQL and TS cannot disagree", () => {
    for (let days = 1; days <= MAX_DAYS; days++) {
      let exact = 0;
      let remaining = days;
      for (const weekTotal of WEEK_TOTALS_USD) {
        if (remaining <= 0) break;
        const inThisWeek = Math.min(7, remaining);
        exact += inThisWeek === 7 ? weekTotal : (weekTotal * inThisWeek) / 7;
        remaining -= inThisWeek;
      }
      const frac = Math.abs(exact - Math.trunc(exact));
      expect(Math.abs(frac - 0.5)).toBeGreaterThan(1e-6);
    }
  });
});

describe("the shekel figure", () => {
  it("is a display conversion, never a charge", () => {
    expect(usdToIls(42)).toBe(134);
    expect(usdToIls(80)).toBe(256);
    expect(usdToIls(114)).toBe(365);
    expect(usdToIls(145)).toBe(464);
  });

  it("lands within a rounding of where the shekel pricing started", () => {
    // The old list was ₪133 / ₪253 / ₪361 / ₪458. Moving the money to dollars
    // was not meant to be a price rise, and this is the check that it was not.
    const before = [133, 253, 361, 458];
    PACKAGES.forEach((days, i) => {
      const now = usdToIls(priceUsd(days));
      expect(Math.abs(now - before[i]!) / before[i]!).toBeLessThan(0.02);
    });
  });

  it("uses a fixed rate, so the page and the listing cannot disagree", () => {
    expect(ILS_PER_USD).toBe(3.2);
  });
});

describe("usdToCents", () => {
  it("gives the payment provider whole cents", () => {
    // fungies takes integer minor units: $42 is 4200, not 42.
    expect(usdToCents(42)).toBe(4200);
    expect(usdToCents(5.18)).toBe(518);
    expect(Number.isInteger(usdToCents(114))).toBe(true);
  });
});

describe("priceBreakdown", () => {
  it("shows the saving against the headline rate", () => {
    expect(priceBreakdown(7).savedUsd).toBe(0);
    expect(priceBreakdown(28).savedUsd).toBe(28 * DAY_RATE_USD - 145);
    expect(priceBreakdown(28).savedUsd).toBe(23);
  });

  it("lists one entry per week touched", () => {
    expect(priceBreakdown(7).weeks).toEqual([42]);
    expect(priceBreakdown(14).weeks).toEqual([42, 38]);
    expect(priceBreakdown(28).weeks).toEqual([42, 38, 34, 31]);
  });

  it("carries both currencies", () => {
    const b = priceBreakdown(14);
    expect(b.totalUsd).toBe(80);
    expect(b.totalIls).toBe(256);
  });
});

describe("isPackage", () => {
  it("recognises exactly what self-serve sells", () => {
    for (const d of PACKAGES) expect(isPackage(d)).toBe(true);
    expect(isPackage(10)).toBe(false);
    expect(isPackage(0)).toBe(false);
  });
});

describe("the free tier", () => {
  it("is seven days and costs nothing", () => {
    expect(FREE_DAYS).toBe(7);
    expect(planPriceUsd("free", FREE_DAYS)).toBe(0);
  });

  it("charges list price for a promoted listing of the same length", () => {
    expect(planPriceUsd("sponsored", 7)).toBe(42);
    expect(planPriceUsd("sponsored", 28)).toBe(145);
  });

  it("offers free first, then the four packages", () => {
    expect(LIFESPAN_OPTIONS.map((o) => o.days)).toEqual([7, 7, 14, 21, 28]);
    expect(LIFESPAN_OPTIONS[0]!.plan).toBe("free");
    expect(LIFESPAN_OPTIONS.slice(1).every((o) => o.plan === "sponsored")).toBe(true);
  });
});
