import { describe, expect, it } from "vitest";
import {
  BENEFITS,
  SALARY_MAX_ILS,
  SALARY_MIN_ILS,
  TOTAL_COMP_MAX_YEAR_ILS,
  benefitLabel,
  checkSalary,
  checkTotalComp,
  cleanBenefits,
} from "./compensation";

describe("checkSalary", () => {
  it("accepts an ordinary Israeli monthly range", () => {
    const r = checkSalary(25000, 35000);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      min: 25000,
      max: 35000,
      currency: "ILS",
      period: "month",
      source: "employer",
    });
  });

  it("accepts a single figure stated as both ends", () => {
    expect(checkSalary(18000, 18000).ok).toBe(true);
  });

  it("tolerates how people actually type money", () => {
    const r = checkSalary("₪25,000", "35,000 ");
    expect(r.ok).toBe(true);
    expect(r.value!.min).toBe(25000);
    expect(r.value!.max).toBe(35000);
  });

  it("requires both ends", () => {
    expect(checkSalary(null, 30000).problem).toBe("missing");
    expect(checkSalary(30000, "").problem).toBe("missing");
    expect(checkSalary(undefined, undefined).problem).toBe("missing");
  });

  it("rejects text", () => {
    expect(checkSalary("competitive", "DOE").problem).toBe("not_a_number");
  });

  it("catches the annual figure typed into a monthly field", () => {
    /*
     * The whole reason the ceiling was lowered from ₪1,000,000 to ₪150,000.
     * These are the annual packages people actually type, and at the old
     * ceiling every one of them passed and published as a monthly salary.
     */
    expect(checkSalary(300000, 420000).problem).toBe("above_maximum");
    expect(checkSalary(40000, 600000).problem).toBe("above_maximum");
    expect(checkSalary(SALARY_MAX_ILS, SALARY_MAX_ILS).ok).toBe(true);
    expect(checkSalary(SALARY_MAX_ILS, SALARY_MAX_ILS + 1).problem).toBe("above_maximum");
  });

  it("rejects a figure too low to be a full-time monthly salary", () => {
    expect(checkSalary(3000, 5000).problem).toBe("below_minimum");
    expect(checkSalary(SALARY_MIN_ILS, SALARY_MIN_ILS).ok).toBe(true);
  });

  it("reports an inverted range as inverted, not as below the minimum", () => {
    // Both checks would fire on (3000, 40000) reversed. Naming the real
    // mistake matters: told "too low", a person edits the wrong box.
    expect(checkSalary(40000, 3000).problem).toBe("inverted");
  });

  it("rounds to whole shekels", () => {
    expect(checkSalary(25000.4, 35000.6).value).toMatchObject({ min: 25000, max: 35001 });
  });
});

describe("checkTotalComp", () => {
  it("reads an annual TC range", () => {
    expect(checkTotalComp(400000, 600000, "year")).toMatchObject({
      min: 400000,
      max: 600000,
      currency: "ILS",
      period: "year",
    });
  });

  it("is optional: an empty or half-filled input is simply absent", () => {
    expect(checkTotalComp("", "")).toBeNull();
    expect(checkTotalComp(400000, null)).toBeNull();
    expect(checkTotalComp(null, 600000)).toBeNull();
  });

  it("drops nonsense rather than storing it", () => {
    expect(checkTotalComp(600000, 400000, "year")).toBeNull();
    expect(checkTotalComp(0, 100, "year")).toBeNull();
    expect(checkTotalComp(1, 99_000_000_000, "year")).toBeNull();
  });

  it("has its own ceiling, far above the base-salary one", () => {
    /*
     * TC includes equity, so it is a different order of magnitude from base.
     * Deriving its cap from SALARY_MAX_ILS would silently drop a real
     * executive package the moment the base ceiling was tightened — silently,
     * because a malformed TC is dropped rather than reported.
     */
    expect(checkTotalComp(100, 3_000_000, "year")).not.toBeNull();
    expect(checkTotalComp(100, TOTAL_COMP_MAX_YEAR_ILS, "year")).not.toBeNull();
    expect(checkTotalComp(100, TOTAL_COMP_MAX_YEAR_ILS + 1, "year")).toBeNull();
  });
});

describe("cleanBenefits", () => {
  it("keeps catalogue keys and drops everything else", () => {
    expect(cleanBenefits(["equity_rsu", "parking", "free_unicorns", 7, null])).toEqual([
      "equity_rsu",
      "parking",
    ]);
  });

  it("returns catalogue order, so two identical listings render identically", () => {
    const a = cleanBenefits(["parking", "equity_options"]);
    const b = cleanBenefits(["equity_options", "parking"]);
    expect(a).toEqual(b);
    // equity comes before daily in the catalogue
    expect(a[0]).toBe("equity_options");
  });

  it("de-duplicates", () => {
    expect(cleanBenefits(["parking", "parking"])).toEqual(["parking"]);
  });

  it("survives a non-array", () => {
    expect(cleanBenefits(null)).toEqual([]);
    expect(cleanBenefits("parking")).toEqual([]);
  });
});

describe("the catalogue itself", () => {
  it("has unique keys", () => {
    const keys = BENEFITS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("labels every key, and falls back to the key for anything unknown", () => {
    for (const b of BENEFITS) expect(benefitLabel(b.key)).toBe(b.label);
    expect(benefitLabel("something_scraped")).toBe("something_scraped");
  });
});
