import { describe, expect, it } from "vitest";
import { explainMatch, type MatchWhy } from "./match-why";

const base: MatchWhy = {
  matched_required: ["react", "typescript"],
  matched_nice: [],
  missing_required: [],
  seniority: { job: "mid", want_lo: "mid", want_hi: "senior", delta: 0 },
  years: { req_min: null, req_max: null, mine: 4 },
  region: { job: "tel_aviv", ok: true },
  remote: { job: "hybrid", ok: true },
  function: { job: "software_engineering", ok: true },
};

const with_ = (over: Partial<MatchWhy>): MatchWhy => ({ ...base, ...over });

describe("explainMatch", () => {
  it("names what the reader actually has", () => {
    const { positives } = explainMatch(base);
    expect(positives[0]).toBe("You have react and typescript");
  });

  it("returns at most one negative, ever", () => {
    /*
     * The whole design. A card listing every gap is a rejection letter, and a
     * reader looking at ten of them stops reading — the honest matches and the
     * hopeless ones become indistinguishable.
     */
    const everythingWrong = with_({
      missing_required: ["kafka", "go"],
      seniority: { job: "lead", want_lo: "junior", want_hi: "mid", delta: 2 },
      years: { req_min: 8, req_max: null, mine: 3 },
      region: { job: "north", ok: false },
      remote: { job: "onsite", ok: false },
      function: { job: "data", ok: false },
    });
    const { negative } = explainMatch(everythingWrong);
    expect(typeof negative).toBe("string");
    // Seniority wins: it is the gap that wastes a whole application.
    expect(negative).toBe("Asks for Team lead; you chose up to Mid-level");
  });

  it("names the years gap when seniority is fine", () => {
    const { negative } = explainMatch(
      with_({ years: { req_min: 7, req_max: null, mine: 4 } }),
    );
    expect(negative).toBe("Wants 7+ years; you list 4");
  });

  it("does not quibble over a single year", () => {
    // 4 against "5+" is within the noise of how people count their own years,
    // and saying so would be discouraging somebody out of a job they can do.
    expect(explainMatch(with_({ years: { req_min: 5, req_max: null, mine: 4 } })).negative)
      .toBeNull();
  });

  it("lists missing skills when nothing worse is wrong", () => {
    const { negative, missing } = explainMatch(with_({ missing_required: ["kafka", "go"] }));
    expect(negative).toBe("Missing: kafka and go");
    // Also returned separately, for the "I have this" chips.
    expect(missing).toEqual(["kafka", "go"]);
  });

  it("caps a long missing list rather than printing it all", () => {
    const { negative } = explainMatch(
      with_({ missing_required: ["kafka", "go", "rust", "scala", "elixir"] }),
    );
    expect(negative).toBe("Missing: kafka, go and rust and 2 more");
  });

  it("says when the role is below the level asked for", () => {
    const { negative } = explainMatch(
      with_({ seniority: { job: "junior", want_lo: "senior", want_hi: "lead", delta: -2 } }),
    );
    expect(negative).toBe("Junior role; you chose from Senior up");
  });

  it("falls through to work setup, then region, then field", () => {
    expect(explainMatch(with_({ remote: { job: "onsite", ok: false } })).negative).toBe(
      "On-site; you asked for something else",
    );
    expect(explainMatch(with_({ region: { job: "north", ok: false } })).negative).toBe(
      "Outside the regions you chose",
    );
    expect(explainMatch(with_({ function: { job: "data", ok: false } })).negative).toBe(
      "A different field from the one you chose",
    );
  });

  it("says nothing when there is nothing to say", () => {
    // A clean match gets positives and no negative at all. Manufacturing a
    // complaint for every card is how a reader learns to ignore the line.
    expect(explainMatch(base).negative).toBeNull();
  });

  it("never penalises a job that states no seniority", () => {
    // Most social posts do not say, and guessing against the reader would hide
    // real openings behind an invented objection.
    const { negative } = explainMatch(
      with_({ seniority: { job: null, want_lo: "mid", want_hi: "mid", delta: null } }),
    );
    expect(negative).toBeNull();
  });

  it("survives a null or empty why", () => {
    expect(explainMatch(null)).toEqual({ positives: [], negative: null, missing: [] });
    expect(explainMatch({})).toEqual({ positives: [], negative: null, missing: [] });
  });
});
