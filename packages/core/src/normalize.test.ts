import { resolveLocation, extractSkills } from "./decompose";
import { describe, expect, it } from "vitest";

import {
  collapseGenderForms,
  decodeEntities,
  detectLang,
  normalizeHe,
  stripHtml,
} from "./normalize";
import { containsTerm, findTerm } from "./text";
import { CITY_COUNT } from "./data/locations";
import { SKILL_TERM_COUNT } from "./data/skills";

describe("normalizeHe", () => {
  it("strips niqqud", () => {
    // the final mem also folds to a regular mem, per the SQL contract
    expect(normalizeHe("שָׁלוֹם")).toBe("שלומ");
    expect(normalizeHe("מְפַתֵּחַ")).toBe("מפתח");
  });

  it("maps final letters to their regular forms", () => {
    // sofit kaf/mem/nun/pe/tsadi -> kaf/mem/nun/pe/tsadi
    expect(normalizeHe("ךםןףץ")).toBe("כמנפצ");
    expect(normalizeHe("ירושלים")).toBe("ירושלימ");
    expect(normalizeHe("ראשון")).toBe("ראשונ");
  });

  it("lowercases Latin and collapses whitespace", () => {
    expect(normalizeHe("  Senior   BACKEND\tDeveloper \n")).toBe("senior backend developer");
  });

  it("is null-safe", () => {
    expect(normalizeHe(null)).toBe("");
    expect(normalizeHe(undefined)).toBe("");
  });

  it("is idempotent", () => {
    const once = normalizeHe("מְפַתֵּחַ  Full-Stack   בתל אביב");
    expect(normalizeHe(once)).toBe(once);
  });
});

describe("collapseGenderForms", () => {
  it("collapses the slash form", () => {
    expect(collapseGenderForms("מפתח/ת")).toBe("מפתח");
  });

  it("collapses the /ית form", () => {
    expect(collapseGenderForms("אנליסט/ית נתונים")).toBe("אנליסט נתונים");
  });

  it("collapses the parenthesised form", () => {
    expect(collapseGenderForms("מעצב(ת) חווית משתמש")).toBe("מעצב חווית משתמש");
  });

  it("collapses standalone feminine role nouns", () => {
    expect(collapseGenderForms("מפתחת תוכנה")).toBe("מפתח תוכנה");
    expect(collapseGenderForms("מהנדסת בדיקות")).toBe("מהנדס בדיקות");
  });

  it("leaves ordinary words ending in tav alone", () => {
    expect(collapseGenderForms("מהנדס תשתית")).toBe("מהנדס תשתית");
  });

  it("strips English EEO decorations", () => {
    expect(collapseGenderForms("Software Engineer (m/f/d)").trim()).toBe("Software Engineer");
  });
});

describe("stripHtml", () => {
  it("keeps list items on their own lines", () => {
    const out = stripHtml("<ul><li>Node.js</li><li>PostgreSQL</li></ul>");
    expect(out.split("\n").filter(Boolean)).toHaveLength(2);
    expect(out).toContain("Node.js");
  });

  it("decodes entity-escaped markup (the Greenhouse shape)", () => {
    const escaped = "&lt;p&gt;We use &lt;strong&gt;Kafka&lt;/strong&gt; &amp; Redis&lt;/p&gt;";
    const out = stripHtml(escaped);
    expect(out).toContain("Kafka");
    expect(out).toContain("&");
    expect(out).not.toContain("<");
  });

  it("drops script and style blocks", () => {
    expect(stripHtml("<p>hi</p><script>alert(1)</script>")).not.toContain("alert");
  });

  it("preserves Hebrew text", () => {
    expect(stripHtml("<p>דרישות התפקיד</p>")).toBe("דרישות התפקיד");
  });
});

describe("decodeEntities", () => {
  it("handles numeric and hex references", () => {
    expect(decodeEntities("&#1500;&#1488;")).toBe("לא");
    expect(decodeEntities("&#x5D0;")).toBe("א");
  });
});

describe("detectLang", () => {
  it("detects Hebrew", () => {
    expect(detectLang("דרוש מפתח תוכנה לצוות הפיתוח שלנו")).toBe("he");
  });

  it("detects English", () => {
    expect(detectLang("We are hiring a backend engineer")).toBe("en");
  });

  it("detects mixed", () => {
    expect(detectLang("דרוש מפתח Backend with strong Node.js and TypeScript experience today")).toBe(
      "mixed",
    );
  });
});

describe("boundary-aware matching", () => {
  it("does not match inside a longer Latin word", () => {
    expect(containsTerm("awesome tooling", "aws")).toBe(false);
    expect(containsTerm("we use aws heavily", "aws")).toBe(true);
  });

  it("allows a Hebrew one-letter clitic before the term", () => {
    expect(containsTerm("המשרה בתל אביב", "תל אביב")).toBe(true);
  });

  it("does not match a Hebrew term glued to a longer word", () => {
    expect(findTerm("מתלאביבים", "תל אביב")).toBe(-1);
  });
});

describe("dictionary size floors (PLAN 5.2)", () => {
  it("ships at least 60 Israeli cities", () => {
    expect(CITY_COUNT).toBeGreaterThanOrEqual(60);
  });

  it("ships at least 400 normalized tech terms", () => {
    expect(SKILL_TERM_COUNT).toBeGreaterThanOrEqual(400);
  });
});

describe("resolveLocation and the title's location slot", () => {
  it("marks abroad when the title names a country where a location goes", () => {
    for (const title of [
      "Site Reliability Engineer, Infrastructure Platforms — UK",
      "Data Labeling Associate - Portuguese (Portugal)",
      "Backend Developer, Berlin",
    ]) {
      // A Tel Aviv mention in the body used to win over this. It should not:
      // the body says where the employer is, the title says where the job is.
      const { location } = resolveLocation(null, "Our Tel Aviv office supports this team.", title);
      expect(location.abroad, title).toBe(true);
    }
  });

  it("does not mistake a country inside a company name for a location", () => {
    const { location } = resolveLocation(
      null,
      "משרה בתל אביב",
      "We are hiring on behalf of Germany Trade & Invest (GTAI)",
    );
    expect(location.abroad).toBe(false);
  });

  it("keeps a job that names Israel alongside a foreign office", () => {
    const { location } = resolveLocation(null, "", "Product Manager (Tel Aviv)");
    expect(location.abroad).toBe(false);
  });

  it("still resolves an ordinary Israeli listing", () => {
    const { location } = resolveLocation("Tel Aviv", "", "Backend Engineer");
    expect(location.abroad).toBe(false);
    expect(location.country).toBe("IL");
  });
});

describe("skill extraction does not over-match generic words", () => {
  it("does not read 'lifecycle marketing' out of an engineering description", () => {
    for (const t of [
      "Own the software development lifecycle from design to production.",
      "Experience across the full product lifecycle.",
      "Manage asset lifecycle and observability for the platform.",
    ]) {
      expect(extractSkills(t), t).not.toContain("lifecycle marketing");
    }
  });

  it("still finds it when it is actually meant", () => {
    expect(extractSkills("Run lifecycle marketing across email and push.")).toContain(
      "lifecycle marketing",
    );
  });
});

describe("abroad detection on the structured location field", () => {
  it("catches the two shapes a user reported", () => {
    // Both were stored as country IL, abroad false.
    expect(resolveLocation("Moldova, Chișinău, Chisinau, On-site", "", "Full-Stack Software Engineer")
      .location.abroad).toBe(true);
    expect(resolveLocation("Honolulu, HI (onsite)", "", "Forward Deployed Software Engineer")
      .location.abroad).toBe(true);
  });

  it("catches the US shapes ATS feeds actually write", () => {
    for (const raw of [
      "US-CA-Menlo Park",
      "US-WA-Bellevue",
      "Somerville, MA, Global HQ",
      "Washington, D.C.",
      "Austin, TX",
      "Gurugram, India",
    ]) {
      expect(resolveLocation(raw, "", "Software Engineer").location.abroad, raw).toBe(true);
    }
  });

  it("never marks an Israeli location abroad, even an unfamiliar one", () => {
    // These all resolve to no known city today; none of them may be called abroad.
    for (const raw of [
      "Tel Aviv-Yafo, Tel Aviv District, Israel, Israel",
      "Israel",
      "Center, Center District",
      "איירפורט סיטי",
      "באר יעקב",
      "רמת החייל",
      "יקום",
      "מרכז",
      "Remote",
      "Hybrid",
      "",
    ]) {
      expect(resolveLocation(raw, "", "Backend Engineer").location.abroad, raw).toBe(false);
    }
  });

  it("does not read a US state out of prose", () => {
    // ", in" is Indiana and also the word "in"; the body must never trigger it.
    expect(
      resolveLocation(null, "We work in hybrid mode, in the centre of Tel Aviv", "Engineer")
        .location.abroad,
    ).toBe(false);
  });
});
