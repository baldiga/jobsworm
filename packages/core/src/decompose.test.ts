import { describe, expect, it } from "vitest";
import {
  classifyEducation,
  classifyFunction,
  classifyRemote,
  classifySeniority,
  extractSkills,
  extractYears,
  hebrewBoundaryOk,
  looksLikeAgency,
  normalizeTitle,
  resolveLocation,
  splitSections,
} from "./decompose";

/**
 * Direct tests for the decomposition rules.
 *
 * Until now these were exercised only through `decompose()` on whole postings,
 * which means a change to `extractYears` was judged by whether some end-to-end
 * fixture still passed. That is how "5+ years backend, 2 years React" returned
 * 2 for months without anybody noticing: nothing asserted on the function that
 * was wrong.
 *
 * Every case below is a real shape from the index, not a synthetic one.
 */

describe("extractYears", () => {
  it("takes the role's requirement, not the smallest number in the text", () => {
    // The reported bug. "2 years React" is a detail about one skill; "5+ years
    // backend experience" is the ask, and it is what seniority keys off.
    expect(extractYears("5+ years backend experience, 2 years React").min).toBe(5);
    expect(
      extractYears("We want 2 years of React and 5+ years of backend experience").min,
    ).toBe(5);
  });

  it("reads a range", () => {
    expect(extractYears("3-5 years of experience building distributed systems")).toEqual({
      min: 3,
      max: 5,
    });
    expect(extractYears("3 to 5 years of experience")).toEqual({ min: 3, max: 5 });
  });

  it("ignores a year figure that is not a requirement", () => {
    // "founded 8 years ago" is about the company, not the candidate.
    const r = extractYears(
      "The company was founded 8 years ago. We are looking for 3+ years of experience.",
    );
    expect(r.min).toBe(3);
  });

  it("reads Hebrew digits and number words", () => {
    expect(extractYears("דרוש מפתח עם 4 שנות ניסיון").min).toBe(4);
    expect(extractYears("נדרש ניסיון של שנתיים").min).toBe(2);
    expect(extractYears("חמש שנים בתחום").min).toBe(5);
  });

  it("returns nothing when the posting never says", () => {
    expect(extractYears("We are hiring a backend engineer for our platform team")).toEqual({
      min: null,
      max: null,
    });
  });

  it("refuses an implausible figure", () => {
    // "Founded in 1998" and similar must not become a 98-year requirement.
    expect(extractYears("Serving customers for 45 years").min).toBeNull();
  });
});

describe("extractSkills", () => {
  it("finds Latin skill names", () => {
    const skills = extractSkills("Experience with Python, PostgreSQL and Kubernetes on AWS");
    expect(skills).toContain("python");
    expect(skills).toContain("postgresql");
    expect(skills).toContain("kubernetes");
    expect(skills).toContain("aws");
  });

  it("finds a skill written in Hebrew behind a clitic", () => {
    // ב־ glues onto the following word, so an ASCII-only boundary never sees
    // a word start here. This is the case the Hebrew boundary rule exists for.
    expect(extractSkills("ניסיון בפייתון")).toContain("python");
    expect(extractSkills("ניסיון בריאקט ובאנגולר")).toContain("angular");
  });

  it("does not match an alias buried inside a longer Hebrew word", () => {
    // The other direction of the same ASCII-only trap: a Hebrew letter on
    // either side is invisible to [A-Za-z0-9], so anything matched happily.
    expect(hebrewBoundaryOk("מסגורית", 2, 3)).toBe(false);
    expect(hebrewBoundaryOk("בפייתון", 1, 6)).toBe(true);
    expect(hebrewBoundaryOk("פייתון", 0, 6)).toBe(true);
  });

  it("returns each skill once, in first-seen order", () => {
    const skills = extractSkills("Python, Django and more Python");
    expect(skills.filter((s) => s === "python")).toHaveLength(1);
  });

  it("does not read 'go to market' as the Go language", () => {
    expect(extractSkills("Own the go to market strategy")).not.toContain("go");
  });

  it("does read Go when it sits in a list of languages", () => {
    expect(extractSkills("Programming languages: Go, Rust, Python")).toContain("go");
  });

  it("survives empty and junk input", () => {
    expect(extractSkills("")).toEqual([]);
    expect(extractSkills("   \n  ")).toEqual([]);
  });
});

describe("classifyFunction", () => {
  const fn = (title: string, body = "") =>
    classifyFunction(title.toLowerCase(), `${title}\n${body}`).fn;

  it("reads the obvious ones off the title", () => {
    expect(fn("Senior Backend Engineer")).toBe("software_engineering");
    expect(fn("DevOps Engineer")).toBe("devops");
    expect(fn("QA Automation Engineer")).toBe("qa");
    expect(fn("Product Manager")).toBe("product");
    expect(fn("Data Analyst")).toBe("data");
  });

  it("reads Hebrew titles", () => {
    expect(fn("מפתח בקאנד")).toBe("software_engineering");
    expect(fn("מעצבת UX")).toBe("design");
  });

  it("keeps the business functions apart", () => {
    expect(fn("Account Executive")).toBe("sales");
    expect(fn("Performance Marketing Manager")).toBe("marketing");
    expect(fn("Customer Success Manager")).toBe("customer_success");
  });
});

describe("classifySeniority", () => {
  it("lets the title win over the years", () => {
    // "Senior" in the title beats "2 years" in the body, because a title is a
    // statement and a body figure is often about one skill.
    const r = classifySeniority("senior backend engineer", "2 years of React");
    expect(r.seniority).toBe("senior");
  });

  it("falls back to years when the title says nothing", () => {
    expect(classifySeniority("backend engineer", "5+ years of experience").seniority).toBe(
      "senior",
    );
    expect(classifySeniority("backend engineer", "1 year of experience").seniority).toBe("junior");
  });

  it("reads Hebrew title cues", () => {
    expect(classifySeniority("מפתח בכיר", "").seniority).toBe("senior");
    expect(classifySeniority("מפתח ג'וניור", "").seniority).toBe("junior");
  });

  it("does not invent a seniority from nothing", () => {
    expect(classifySeniority("backend engineer", "Join our team").seniority).toBeNull();
  });
});

describe("classifyRemote", () => {
  it("reads the three modes", () => {
    expect(classifyRemote("This is a fully remote position", false).remote).toBe("remote");
    expect(classifyRemote("Hybrid, three days a week in the office", true).remote).toBe("hybrid");
    // "from our office" is an explicit cue. A bare city name is not, and the
    // classifier is right not to infer on-site from prose that merely has one.
    expect(classifyRemote("You will work from our office", false).remote).toBe("onsite");
  });

  it("reads Hebrew", () => {
    expect(classifyRemote("עבודה היברידית", true).remote).toBe("hybrid");
    expect(classifyRemote("עבודה מרחוק", false).remote).toBe("remote");
  });

  it("says unknown rather than guessing", () => {
    expect(classifyRemote("We are hiring a backend engineer", false).remote).toBe("unknown");
  });
});

describe("resolveLocation", () => {
  it("finds an Israeli city", () => {
    const { location } = resolveLocation("Tel Aviv", "", "");
    expect(location.city).toBeTruthy();
    expect(location.abroad).toBe(false);
  });

  it("reads a Hebrew city name", () => {
    const { location } = resolveLocation("תל אביב", "", "");
    expect(location.abroad).toBe(false);
    expect(location.city).toBeTruthy();
  });

  it("marks a foreign city abroad", () => {
    expect(resolveLocation("Berlin, Germany", "", "").location.abroad).toBe(true);
    expect(resolveLocation("New York, NY", "", "").location.abroad).toBe(true);
  });

  it("reads US-IL-Chicago as Illinois, not Israel", () => {
    /*
     * The bug that put 332 foreign jobs in the index and reported it clean:
     * an audit read `location.country`, which defaults to IL, and "US-IL" was
     * taken for an Israeli country code.
     */
    const { location } = resolveLocation("US-IL-Chicago", "", "");
    expect(location.abroad).toBe(true);
  });

  it("does not claim a location it was never given", () => {
    const { location } = resolveLocation(null, "We are hiring an engineer", "Engineer");
    expect(location.city).toBeNull();
  });
});

describe("classifyEducation", () => {
  it("reads a degree requirement", () => {
    // The enum distinguishes "required" from "an advantage"; both name a
    // degree, and which one it is matters to the no-degree filter later.
    expect(classifyEducation("BSc in Computer Science or equivalent")).toMatch(/bsc/);
    expect(classifyEducation("MSc or PhD in a quantitative field")).not.toBe("none");
  });

  it("reads Hebrew", () => {
    expect(classifyEducation("תואר ראשון במדעי המחשב")).toMatch(/bsc/);
  });

  it("returns none when no degree is mentioned", () => {
    expect(classifyEducation("5 years of backend experience")).toBe("none");
  });
});

describe("looksLikeAgency", () => {
  it("catches an agency writing about somebody else's vacancy", () => {
    expect(looksLikeAgency("Our client, a leading fintech, is hiring", "")).toBe(true);
    expect(looksLikeAgency("חברת השמה מובילה מחפשת", "")).toBe(true);
  });

  it("leaves an employer alone", () => {
    expect(looksLikeAgency("We are hiring a backend engineer for our platform team", "")).toBe(
      false,
    );
  });
});

describe("normalizeTitle", () => {
  it("strips a trailing location", () => {
    expect(normalizeTitle("Backend Engineer - Tel Aviv", ["tel aviv"])).not.toContain("tel aviv");
  });

  it("lowercases, collapses whitespace, and drops the seniority word", () => {
    // Seniority is its own column. Leaving it in the normalised title would
    // make every title match for "backend engineer" miss the senior ones.
    expect(normalizeTitle("  Senior   Backend   Engineer  ", [])).toBe("backend engineer");
    expect(normalizeTitle("  Backend   Engineer  ", [])).toBe("backend engineer");
  });

  it("survives an empty title", () => {
    expect(normalizeTitle("", [])).toBe("");
  });
});

describe("splitSections", () => {
  it("separates requirements from nice-to-haves", () => {
    const sections = splitSections(
      [
        "About the role",
        "You will build things.",
        "Requirements:",
        "- 5 years of Python",
        "Nice to have:",
        "- Kafka",
      ].join("\n"),
    );
    const required = sections.filter((s) => s.kind === "required").flatMap((s) => s.lines);
    const nice = sections.filter((s) => s.kind === "nice").flatMap((s) => s.lines);
    expect(required.join(" ")).toContain("Python");
    expect(nice.join(" ")).toContain("Kafka");
  });

  it("reads Hebrew headings", () => {
    const sections = splitSections(["דרישות:", "- ניסיון של 3 שנים", "יתרון:", "- Kafka"].join("\n"));
    expect(sections.some((s) => s.kind === "required")).toBe(true);
    expect(sections.some((s) => s.kind === "nice")).toBe(true);
  });

  it("treats an inline advantage cue as nice, wherever it sits", () => {
    // How most Hebrew postings actually mark an optional requirement: not
    // under a heading, but with יתרון on the bullet itself.
    const sections = splitSections(["דרישות:", "- ניסיון ב-Kafka - יתרון"].join("\n"));
    const nice = sections.filter((s) => s.kind === "nice").flatMap((s) => s.lines);
    expect(nice.join(" ")).toContain("Kafka");
  });

  it("survives a description with no headings at all", () => {
    const sections = splitSections("We are hiring an engineer. Apply here.");
    expect(sections.length).toBeGreaterThan(0);
  });
});
