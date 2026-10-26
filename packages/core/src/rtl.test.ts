import { describe, expect, it } from "vitest";
import {
  documentIsVisual,
  looksReversedHebrew,
  repairVisualLine,
  repairVisualText,
  toVisual,
} from "./rtl";
import { parseCv } from "./cv";

const CV = [
  "מפתחת תוכנה בכירה",
  "ניסיון: 6 שנים",
  "חברה: Acme Systems",
  "כישורים: Python, React, Kubernetes",
  "השכלה: תואר ראשון במדעי המחשב",
  "עבודות קודמות במגוון חברות הייטק בתל אביב",
].join("\n");

describe("looksReversedHebrew", () => {
  it("spots a final letter at the start of a word", () => {
    // ך ם ן ף ץ may only end a word. At the start, the text is backwards —
    // an absolute orthographic rule, so no dictionary is needed.
    expect(looksReversedHebrew("םולש")).toBe(true);
    expect(looksReversedHebrew("שלום")).toBe(false);
  });

  it("has no opinion about a line with no Hebrew", () => {
    expect(looksReversedHebrew("Senior Backend Engineer")).toBe(false);
    expect(looksReversedHebrew("")).toBe(false);
  });

  it("recognises common words spelled backwards", () => {
    expect(looksReversedHebrew("ןויסינ לש הרבח")).toBe(true);
  });
});

describe("documentIsVisual", () => {
  it("says no for an ordinary Hebrew CV", () => {
    expect(documentIsVisual(CV)).toBe(false);
  });

  it("says yes for the same CV in visual order", () => {
    expect(documentIsVisual(toVisual(CV))).toBe(true);
  });

  it("refuses to decide on too little text", () => {
    // One odd-looking line is an acronym or a filename, not evidence. Repairing
    // a correctly-ordered document would destroy it, so the bar for acting is
    // higher than the bar for suspecting.
    expect(documentIsVisual("םולש")).toBe(false);
    expect(documentIsVisual("םולש\nםולש")).toBe(false);
  });

  it("says no for a document with no Hebrew at all", () => {
    expect(documentIsVisual("Senior Backend Engineer\nPython, React\n6 years")).toBe(false);
  });
});

describe("repairVisualLine", () => {
  it("is its own inverse on Hebrew", () => {
    expect(repairVisualLine(repairVisualLine("מפתחת תוכנה"))).toBe("מפתחת תוכנה");
  });

  it("keeps Latin runs the right way round", () => {
    // Latin inside an RTL line was laid out left-to-right already, so the
    // whole-line reversal is what broke it.
    const visual = toVisual("כישורים: Python, React");
    expect(repairVisualLine(visual)).toContain("Python");
    expect(repairVisualLine(visual)).toContain("React");
  });

  it("keeps digits and years readable", () => {
    const visual = toVisual("ניסיון: 6 שנים");
    expect(repairVisualLine(visual)).toContain("6");
  });

  it("mirrors brackets", () => {
    // A "(" painted at the right end of an RTL line is logically a ")".
    expect(repairVisualLine(toVisual("(תל אביב) מפתחת"))).toBe("(תל אביב) מפתחת");
  });
});

describe("repairVisualText", () => {
  it("leaves a correctly-ordered document completely alone", () => {
    const { text, repaired } = repairVisualText(CV);
    expect(repaired).toBe(false);
    expect(text).toBe(CV);
  });

  it("leaves an English document completely alone", () => {
    const english = "Senior Backend Engineer\nPython, React, AWS\n6 years of experience";
    expect(repairVisualText(english)).toEqual({ text: english, repaired: false });
  });

  it("restores a visual-order document", () => {
    const { text, repaired } = repairVisualText(toVisual(CV));
    expect(repaired).toBe(true);
    expect(text).toBe(CV);
  });
});

describe("parseCv on a reversed Hebrew CV", () => {
  it("reads the visual-order twin exactly as it reads the original", () => {
    /*
     * The point of the whole module. A Hebrew CV exported by an older Word or
     * a CV builder extracts backwards, every dictionary lookup fails, and the
     * person is told we recognised no skills — for a document that is
     * perfectly legible on their screen.
     */
    const logical = parseCv(CV);
    const visual = parseCv(toVisual(CV));

    expect(visual.skills.sort()).toEqual(logical.skills.sort());
    expect(visual.yearsExperience).toBe(logical.yearsExperience);
    expect(visual.jobFunction).toBe(logical.jobFunction);
  });

  it("still finds real skills in the reversed version", () => {
    // Not just "equal to the broken original" — actually correct.
    const visual = parseCv(toVisual(CV));
    expect(visual.skills).toContain("python");
    expect(visual.skills).toContain("react");
  });
});
