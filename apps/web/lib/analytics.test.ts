import { describe, expect, it } from "vitest";
import { qHash, queryLang, stripTrackedParams } from "./analytics";

describe("stripTrackedParams", () => {
  it("removes the search query and the exclusion list", () => {
    expect(stripTrackedParams("https://www.jobswarm.fun/jobs?q=react&page=2")).toBe(
      "https://www.jobswarm.fun/jobs?page=2",
    );
    expect(stripTrackedParams("https://www.jobswarm.fun/jobs?exclude=senior")).toBe(
      "https://www.jobswarm.fun/jobs",
    );
  });

  it("keeps everything that is not what somebody typed", () => {
    // Filters are chosen from a fixed list, so they are safe to keep and are
    // the only way to read the numbers by facet later.
    const url = "https://www.jobswarm.fun/jobs?region=tel_aviv&seniority=mid&page=3";
    expect(stripTrackedParams(url)).toBe(url);
  });

  it("leaves a URL with nothing sensitive exactly as it was", () => {
    // Not merely equal — unchanged, so the common case allocates no new string
    // and cannot reorder parameters behind our back.
    const url = "https://www.jobswarm.fun/jobs/abc-123";
    expect(stripTrackedParams(url)).toBe(url);
  });

  it("returns empty rather than guessing when the input is not a URL", () => {
    // Sending something we could not parse is how a raw query leaks.
    expect(stripTrackedParams("not a url at all")).toBe("");
    expect(stripTrackedParams("")).toBe("");
  });
});

describe("qHash", () => {
  it("is stable and one-way", async () => {
    const a = await qHash("React Developer");
    expect(a).toHaveLength(16);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toContain("react");
    expect(await qHash("React Developer")).toBe(a);
  });

  it("ignores case and surrounding space, so one query is one hash", async () => {
    expect(await qHash("  react developer ")).toBe(await qHash("React Developer"));
  });

  it("separates different queries", async () => {
    expect(await qHash("react")).not.toBe(await qHash("angular"));
  });

  it("hashes Hebrew as readily as Latin", async () => {
    const he = await qHash("מפתח פולסטאק");
    expect(he).toMatch(/^[0-9a-f]{16}$/);
    expect(he).not.toBe(await qHash("מפתח"));
  });

  it("returns empty for an empty query rather than hashing nothing", async () => {
    expect(await qHash("")).toBe("");
    expect(await qHash("   ")).toBe("");
  });
});

describe("queryLang", () => {
  it("labels the scripts the index actually receives", () => {
    expect(queryLang("react developer")).toBe("en");
    expect(queryLang("מפתח תוכנה")).toBe("he");
    expect(queryLang("מפתח React")).toBe("mixed");
    expect(queryLang("2026")).toBe("other");
  });
});
