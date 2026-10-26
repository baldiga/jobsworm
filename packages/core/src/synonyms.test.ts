import { describe, expect, it } from "vitest";
import {
  SYNONYM_GROUPS,
  expandQuery,
  relatedTerms,
  foldForSearch,
  toWebsearchQuery,
  hebrewVariants,
  queryHebrewVariants,
} from "./synonyms";

describe("foldForSearch", () => {
  it("mirrors normalize_he: lowercases and folds Hebrew finals", () => {
    // Final mem -> medial mem, so a query typed either way matches the index.
    expect(foldForSearch("שיווקם")).toBe("שיווקמ");
    expect(foldForSearch("Marketing")).toBe("marketing");
    expect(foldForSearch("  Data   Engineer ")).toBe("data engineer");
  });
});

describe("expandQuery", () => {
  it("crosses the language boundary in both directions", () => {
    expect(expandQuery("Marketing")).toContain("שיווק");
    expect(expandQuery("שיווק")).toContain("marketing");
  });

  it("covers the roles people actually type", () => {
    expect(expandQuery("developer")).toContain("מפתח");
    expect(expandQuery("מפתח")).toContain("developer");
    expect(expandQuery("sales")).toContain("מכירות");
    expect(expandQuery("qa")).toContain("בדיקות");
    expect(expandQuery("security")).toContain("סייבר");
    expect(expandQuery("remote")).toContain("מהבית");
  });

  it("does not return the query itself", () => {
    expect(expandQuery("marketing")).not.toContain("marketing");
  });

  it("prefers the longest matching phrase over its parts", () => {
    // "product manager" must not be read as "product" + "manager", which would
    // pull in every manager in the index.
    const pm = expandQuery("product manager");
    expect(pm).toContain("מנהל מוצר");
  });

  it("translates a multi-word role that has its own entry", () => {
    expect(expandQuery("מנהל שיווק")).toContain("marketing manager");
    expect(expandQuery("system engineer")).toContain("מהנדס מערכת");
  });

  it("does NOT widen a phrase by expanding one word inside it", () => {
    /*
     * The bug this guards: "system engineer" used to find the known term
     * "engineer" inside itself and emit
     *   "system engineer" or engineer or מהנדס
     * which matched every job containing "engineer" — 1,477 results against a
     * few dozen real ones. A phrase must never be widened by a component word.
     */
    for (const t of expandQuery("system engineer")) {
      expect(t).not.toBe("engineer");
      expect(t).not.toBe("מהנדס");
    }
    // An unknown phrase expands to nothing at all rather than to its parts.
    expect(expandQuery("kubernetes engineer")).toEqual([]);
    expect(expandQuery("senior rust developer")).toEqual([]);
  });

  it("returns nothing for a term it does not know", () => {
    expect(expandQuery("kubernetes")).toEqual([]);
    expect(expandQuery("")).toEqual([]);
  });
});

describe("SYNONYM_GROUPS integrity", () => {
  it("never lists the same term in two groups", () => {
    /*
     * buildIndex unions any groups that share a term, so a duplicate entry
     * silently merges two groups into one. That is how a bare "lead" leaked
     * back into the "team lead" group and made it match every Lead title.
     */
    const seen = new Map<string, number>();
    SYNONYM_GROUPS.forEach((group, i) => {
      for (const term of group) {
        const folded = foldForSearch(term);
        const prev = seen.get(folded);
        expect(
          prev === undefined,
          `"${term}" appears in groups ${prev} and ${i}`,
        ).toBe(true);
        seen.set(folded, i);
      }
    });
  });
});

describe("relatedTerms", () => {
  it("returns neighbours, not equivalents", () => {
    const near = relatedTerms("marketing");
    expect(near).toContain("seo");
    // Direct translations belong in the exact set, never in near matches.
    expect(near).not.toContain("שיווק");
    expect(near).not.toContain("marketing");
  });

  it("is empty for a term with no neighbourhood", () => {
    expect(relatedTerms("zzzznotathing")).toEqual([]);
  });
});

describe("toWebsearchQuery", () => {
  it("joins with or and quotes multi-word terms", () => {
    expect(toWebsearchQuery("marketing", ["שיווק"])).toBe("marketing or שיווק");
    expect(toWebsearchQuery("product", ["מנהל מוצר"])).toBe('product or "מנהל מוצר"');
  });

  it("returns the bare query when there is nothing to add", () => {
    expect(toWebsearchQuery("kubernetes", [])).toBe("kubernetes");
  });
});

describe("hebrewVariants", () => {
  it("reaches the feminine and plural forms of a role word", () => {
    const v = hebrewVariants("מפתח");
    expect(v).toContain("מפתחת");
    expect(v).toContain("מפתחים");
    expect(v).toContain("מפתחות");
  });

  it("goes the other way too: a feminine query reaches the masculine", () => {
    // The case that matters. The index stores what employers write, and most
    // write מפתח; a woman searching מפתחת found nothing.
    expect(hebrewVariants("מפתחת")).toContain("מפתח");
    expect(hebrewVariants("מעצבת")).toContain("מעצב");
  });

  it("strips one leading clitic", () => {
    expect(hebrewVariants("למפתח")).toContain("מפתח");
  });

  it("never returns the token itself", () => {
    expect(hebrewVariants("מפתח")).not.toContain("מפתח");
  });

  it("refuses a stem too short to be a role word", () => {
    // Two-letter Hebrew words are prepositions. Inflecting those would
    // generate common words and match everything.
    expect(hebrewVariants("של")).toEqual([]);
    expect(hebrewVariants("עם")).toEqual([]);
  });

  it("ignores Latin and mixed input", () => {
    expect(hebrewVariants("developer")).toEqual([]);
    expect(hebrewVariants("QA מהנדס")).toEqual([]);
  });
});

describe("queryHebrewVariants", () => {
  it("expands a single Hebrew word", () => {
    expect(queryHebrewVariants("מפתחת").length).toBeGreaterThan(0);
  });

  it("leaves a phrase alone", () => {
    // Inflecting one word of a phrase produces combinations nobody wrote.
    expect(queryHebrewVariants("מנהל שיווק")).toEqual([]);
  });

  it("leaves an English query alone", () => {
    expect(queryHebrewVariants("backend engineer")).toEqual([]);
    expect(queryHebrewVariants("python")).toEqual([]);
  });

  it("handles a written-out gender form before inflecting", () => {
    // collapseGenderForms turns מפתח/ת into מפתח first, so this is a single
    // token by the time variants are generated.
    expect(queryHebrewVariants("מפתח/ת").length).toBeGreaterThan(0);
  });
});
