import { describe, it, expect } from "vitest";
import {
  parseCv,
  splitCvSections,
  extractSpans,
  mergedMonths,
  statedYears,
  structuralTitles,
  seniorityFromYears,
  employmentText,
} from "./cv";

const NOW = new Date("2026-09-09T00:00:00Z");

describe("splitCvSections", () => {
  it("splits on heading lines in both languages", () => {
    const { sections, found } = splitCvSections(
      [
        "Dana Levi",
        "Summary",
        "Growth marketer.",
        "Work Experience",
        "Head of Growth at Wix",
        "Education",
        "BA Economics, TAU",
      ].join("\n"),
    );
    expect(found.sort()).toEqual(["education", "experience", "summary"]);
    expect(sections.experience).toContain("Head of Growth");
    expect(sections.education).toContain("BA Economics");
    expect(sections.summary).toContain("Growth marketer");
    // Everything before the first heading stays out of the way.
    expect(sections.other).toContain("Dana Levi");
  });

  it("does not split on the word experience inside a sentence", () => {
    const { found } = splitCvSections("Deep experience with Kubernetes and Terraform at scale.");
    expect(found).toEqual([]);
  });
});

describe("extractSpans and mergedMonths", () => {
  it("reads month-and-year ranges", () => {
    const spans = extractSpans("Backend Engineer\nJan 2019 - Mar 2022", NOW);
    expect(mergedMonths(spans)).toBe(38);
  });

  it("treats present as today", () => {
    const spans = extractSpans("Head of RevOps\nJune 2025 - Present", NOW);
    // June 2025 to September 2026.
    expect(mergedMonths(spans)).toBe(15);
  });

  it("counts two overlapping jobs once", () => {
    const spans = extractSpans(["Role A\n2018 - 2022", "Role B\n2020 - 2024"].join("\n"), NOW);
    expect(mergedMonths(spans)).toBe(6 * 12); // 2018 to 2024, not 4 + 4 years
  });

  it("ignores a range that ends before it starts", () => {
    expect(extractSpans("2022 - 2019", NOW)).toEqual([]);
  });

  it("ignores dates in the future", () => {
    expect(extractSpans("2030 - 2032", NOW)).toEqual([]);
  });
});

describe("statedYears", () => {
  it("reads a real claim", () => {
    expect(statedYears("7 years of experience in demand generation")).toBe(7);
    expect(statedYears("8 שנות ניסיון בשיווק")).toBe(8);
  });

  it("does not read a number that is not about experience", () => {
    // The old parser took the largest N-years anywhere and returned 10 here.
    expect(statedYears("Led the rebrand of a product that had run for 10 years")).toBeNull();
    expect(statedYears("Graduated 12 years ago")).toBeNull();
  });
});

describe("structuralTitles", () => {
  it("reads a title the curated list has never heard of", () => {
    const titles = structuralTitles("Growth Marketing Lead at Monday.com\n2023 - present");
    expect(titles[0]).toBe("Growth Marketing Lead");
  });

  it("reads a bare title line sitting above its dates", () => {
    const titles = structuralTitles(["Revenue Operations Partner", "2021 - 2024", "Built the CRM."].join("\n"));
    expect(titles).toContain("Revenue Operations Partner");
  });

  it("does not return prose", () => {
    const titles = structuralTitles(
      "Responsible for the full funnel from first touch through to closed won revenue, 2021 - 2024",
    );
    expect(titles).toEqual([]);
  });
});

describe("parseCv", () => {
  const MARKETING_CV = [
    "Dana Levi",
    "Summary",
    "Go-to-market leader.",
    "Work Experience",
    "Head of Revenue Operations at Riskified",
    "Mar 2021 - Present",
    "Owned the HubSpot and Salesforce stack, lead routing, attribution and forecasting.",
    "Built the demand generation reporting the sales team runs on.",
    "Marketing Operations Manager at Similarweb",
    "Jan 2018 - Feb 2021",
    "Ran lifecycle campaigns, MQL scoring and the marketing automation roadmap.",
    "Education",
    "BSc Computer Science, Technion. Coursework in Java, algorithms and databases.",
  ].join("\n");

  it("classifies a RevOps CV as go-to-market, not engineering", () => {
    const cv = parseCv(MARKETING_CV, NOW);
    expect(cv.jobFunction).not.toBeNull();
    expect(["marketing", "sales", "revops", "operations", "bizops"]).toContain(cv.jobFunction);
  });

  it("takes the current role as the current title", () => {
    const cv = parseCv(MARKETING_CV, NOW);
    expect(cv.currentTitle).toBe("Head of Revenue Operations");
  });

  it("counts years from the dates, not from a stray number", () => {
    const cv = parseCv(MARKETING_CV, NOW);
    // Jan 2018 to Sep 2026 is a little under nine years.
    expect(cv.yearsExperience).toBe(9);
    expect(cv.yearsBasis).toBe("dates");
  });

  it("falls back to a stated figure when the CV carries no dates", () => {
    const cv = parseCv("Sales leader with 6 years of experience closing enterprise deals.", NOW);
    expect(cv.yearsExperience).toBe(6);
    expect(cv.yearsBasis).toBe("stated");
  });

  it("distrusts a stated figure far above what the dates show", () => {
    const cv = parseCv(
      ["Experience", "Analyst at Payoneer", "2023 - 2025", "20 years of experience."].join("\n"),
      NOW,
    );
    expect(cv.yearsExperience).toBe(2);
  });

  it("still parses a CV with no headings at all", () => {
    const cv = parseCv("Backend developer. Python, Django, PostgreSQL, Kubernetes.", NOW);
    expect(cv.sectionsFound).toEqual([]);
    expect(cv.skills.length).toBeGreaterThan(0);
  });
});

describe("seniorityFromYears", () => {
  it("maps the bands", () => {
    expect(seniorityFromYears(null)).toBeNull();
    expect(seniorityFromYears(1)).toBe("junior");
    expect(seniorityFromYears(3)).toBe("mid");
    expect(seniorityFromYears(6)).toBe("senior");
    expect(seniorityFromYears(12)).toBe("lead");
  });
});

/*
 * Reported by a user on 2026-09-12: "The system incorrectly calculated my work
 * experience as 12 years based on my CV, while my actual professional
 * experience is approximately 5 years. I can't fix it manually."
 *
 * Both halves were real. These cover the calculation; the profile editor now
 * has a years field for the second half.
 */
describe("years of experience — the twelve-versus-five bug", () => {
  // A CV with an unrecognised experience heading, so the section splitter puts
  // the jobs in `other` and the old code read date ranges from the whole file.
  const CV_UNRECOGNISED_HEADING = `
Dana Levi
dana@example.com

Education
B.Sc. Computer Science, Tel Aviv University, 2013 - 2017

Military Service
IDF, Intelligence Corps, 2010 - 2013

Where I have worked
Backend Engineer, Acme, 2021 - present
Junior Developer, Beta Ltd, 2020 - 2021
`;

  it("does not count a degree and army service as employment", () => {
    const parsed = parseCv(CV_UNRECOGNISED_HEADING, new Date("2026-09-12"));
    /*
     * Education runs 2013-2017 and the army 2010-2013. Merged with the real
     * jobs those spans reach back sixteen years, which is what produced "12".
     * The real career here starts in 2020.
     */
    expect(parsed.yearsExperience).not.toBeNull();
    expect(parsed.yearsExperience!).toBeLessThanOrEqual(7);
  });

  it("believes a stated figure that is far BELOW the dates", () => {
    /*
     * The old rule was max(fromDates, stated), so a person writing "5 years"
     * was overruled by the dates. High claims were doubted and low ones were
     * not, which is backwards.
     *
     * The experience heading here IS recognised, so stripping cannot help: the
     * stray span is inside the work history. A line mentioning how long the
     * company has been going is the usual cause, and only the reconciliation
     * catches it.
     */
    const cv = `
Summary
Software engineer with 5 years of experience.

Experience
Engineer, Acme — a company operating 2008 - present
Joined 2021 - present
`;
    const parsed = parseCv(cv, new Date("2026-09-12"));
    expect(parsed.yearsExperience).toBe(5);
    expect(parsed.yearsBasis).toBe("stated");
  });

  it("still doubts a stated figure far ABOVE the dates", () => {
    const cv = `
Summary
Engineer with 20 years of experience.

Experience
Engineer, Acme, 2022 - present
`;
    const parsed = parseCv(cv, new Date("2026-09-12"));
    expect(parsed.yearsExperience).toBeLessThan(20);
    expect(parsed.yearsBasis).toBe("dates");
  });

  it("keeps a slightly higher stated figure, because CVs omit early jobs", () => {
    const cv = `
Summary
Engineer with 6 years of experience.

Experience
Engineer, Acme, 2021 - present
`;
    const parsed = parseCv(cv, new Date("2026-09-12"));
    expect(parsed.yearsExperience).toBe(6);
  });
});

describe("employmentText", () => {
  const sections = (over: Partial<Record<string, string>> = {}) => ({
    experience: "",
    education: "",
    skills: "",
    summary: "",
    other: "",
    ...over,
  });

  it("uses the experience section when there is one", () => {
    const s = sections({ experience: "Engineer 2020 - 2024\n", education: "B.Sc 2014 - 2018\n" });
    expect(employmentText(s, "whole document")).toBe(s.experience);
  });

  it("strips education when the experience section was not found", () => {
    // The heading has to be present in `whole`: the stripper scans headings
    // there rather than removing the section text by value, so that it also
    // catches military service and volunteering, which have no section of
    // their own and would otherwise be counted as employment.
    const whole = [
      "Dana Levi",
      "Education",
      "B.Sc Computer Science, 2014 - 2018",
      "Where I have worked",
      "Engineer, 2021 - present",
    ].join("\n");
    const out = employmentText(sections(), whole);
    expect(out).not.toContain("2014 - 2018");
    expect(out).toContain("2021 - present");
  });

  it("strips military service, which is what produced the reported 12 years", () => {
    const whole = [
      "Military Service",
      "IDF, 2010 - 2013",
      "Where I have worked",
      "Engineer, 2021 - present",
    ].join("\n");
    const out = employmentText(sections(), whole);
    expect(out).not.toContain("2010 - 2013");
    expect(out).toContain("2021 - present");
  });

  it("keeps the whole document when removing education would gut it", () => {
    // A bad split that swallowed the file must not leave us with nothing to
    // measure — better an over-count than a silent null.
    const whole = "Education\nEverything is in here 2020 - 2024\n";
    const out = employmentText(sections({ education: whole }), whole);
    expect(out).toBe(whole);
  });
});
