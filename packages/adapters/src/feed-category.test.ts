import { describe, it, expect } from "vitest";
import { isTechCategory } from "./feed-category";

describe("isTechCategory", () => {
  it("accepts the categories the feed actually uses for tech", () => {
    for (const c of [
      "הייטק",
      "IT",
      "תמיכה טכנית",
      "מערכות מידע",
      "פיתוח תוכנה",
      "אבטחת מידע",
      "טכנולוגיה",
      "Data Analysis",
      "Cybersecurity",
      "Software Development",
      "QA",
      "ניהול מוצר",
    ]) {
      expect(isTechCategory(c), c).toBe(true);
    }
  });

  it("rejects the rest of a general jobs board", () => {
    for (const c of [
      "מכירות",
      "שירות לקוחות",
      "מסעדנות",
      "סיעוד",
      "נהגים",
      "אבטחה", // guarding. NOT אבטחת מידע
      "הנדסה", // civil and mechanical
      "בקרת איכות", // factory QC, not software QA
      "חינוך",
      "לוגיסטיקה",
      "אדמיניסטרציה",
    ]) {
      expect(isTechCategory(c), c).toBe(false);
    }
  });

  it("does not let 'it' match as a substring", () => {
    // The whole reason the exact list exists.
    for (const c of ["Hospitality", "Restaurant/Hospitality", "Recruitment", "Security"]) {
      expect(isTechCategory(c), c).toBe(false);
    }
  });

  it("treats a missing category as not tech", () => {
    expect(isTechCategory(null)).toBe(false);
    expect(isTechCategory("")).toBe(false);
    expect(isTechCategory("   ")).toBe(false);
  });
});
