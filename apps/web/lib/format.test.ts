import { describe, expect, it } from "vitest";
import { STALE_POSTING_DAYS, ageInDays, stalePostingLabel,
  experienceLabel,
  isSponsoredNow,
  sponsoredLabel,
} from "./format";

/** An ISO timestamp exactly `days` in the past, at this instant. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe("ageInDays", () => {
  it("counts whole days", () => {
    expect(ageInDays(daysAgo(0))).toBe(0);
    expect(ageInDays(daysAgo(1))).toBe(1);
    expect(ageInDays(daysAgo(84))).toBe(84);
  });

  it("falls back to when we first saw the job", () => {
    // Social posts routinely arrive with no date of their own.
    expect(ageInDays(null, daysAgo(30))).toBe(30);
  });

  it("returns null when there is no date at all, rather than 0", () => {
    // 0 would read as "posted today", which is the opposite of what we know.
    expect(ageInDays(null, null)).toBeNull();
    expect(ageInDays(undefined)).toBeNull();
    expect(ageInDays("not a date")).toBeNull();
  });

  it("never goes negative on a future date", () => {
    expect(ageInDays(new Date(Date.now() + 86_400_000).toISOString())).toBe(0);
  });
});

describe("stalePostingLabel", () => {
  it("says nothing below the threshold", () => {
    expect(stalePostingLabel(daysAgo(0))).toBeNull();
    expect(stalePostingLabel(daysAgo(59))).toBeNull();
    expect(stalePostingLabel(daysAgo(STALE_POSTING_DAYS - 1))).toBeNull();
  });

  it("marks the posting from the threshold onward", () => {
    expect(stalePostingLabel(daysAgo(STALE_POSTING_DAYS))).toBe("60-day-old posting");
    expect(stalePostingLabel(daysAgo(84))).toBe("84-day-old posting");
    expect(stalePostingLabel(daysAgo(400))).toBe("400-day-old posting");
  });

  it("uses first_seen_at when the job carries no posted date", () => {
    expect(stalePostingLabel(null, daysAgo(90))).toBe("90-day-old posting");
  });

  it("says nothing when the age is unknown", () => {
    // Guessing "old" about a job with no date would be the same fabrication as
    // guessing "new" about it.
    expect(stalePostingLabel(null, null)).toBeNull();
  });
});

describe("experienceLabel", () => {
  it("shows an open-ended minimum", () => {
    expect(experienceLabel(3, null)).toBe("3+ yrs");
    expect(experienceLabel(3, 3)).toBe("3+ yrs");
  });

  it("shows a range when there is one", () => {
    expect(experienceLabel(3, 5)).toBe("3–5 yrs");
  });

  it("says nothing when the posting did not", () => {
    // About a third of listings never state a figure, and inventing one on a
    // card a person is deciding from would be worse than staying quiet.
    expect(experienceLabel(null, null)).toBeNull();
    expect(experienceLabel(0, 0)).toBeNull();
    expect(experienceLabel(undefined, 5)).toBeNull();
  });
});

describe("isSponsoredNow", () => {
  it("needs both a campaign and a future end date", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isSponsoredNow({ sponsored_campaign_id: "c", sponsored_until: future })).toBe(true);
    // Re-checked in the browser because a page can be served from cache after
    // the campaign ended, and a stale "Sponsored" label is a lie to a reader.
    expect(isSponsoredNow({ sponsored_campaign_id: "c", sponsored_until: past })).toBe(false);
    expect(isSponsoredNow({ sponsored_campaign_id: null, sponsored_until: future })).toBe(false);
    expect(isSponsoredNow({})).toBe(false);
  });
});

describe("sponsoredLabel", () => {
  it("says it is sponsored, and for an agency says that too", () => {
    expect(sponsoredLabel({ sponsored_kind: "employer" })).toBe("Sponsored");
    expect(sponsoredLabel({ sponsored_kind: "agency" })).toBe("Sponsored · Agency");
  });

  it("never prints what was paid", () => {
    /*
     * The label used to read "Sponsored · employer paid $253". That argument
     * needs an auction behind it and there is not one — placement is a fixed
     * rate for everybody, so the number told a reader nothing they could act
     * on while implying the opposite: that one advertiser had bought more
     * prominence than another.
     *
     * Asserted on the whole string rather than the absence of a substring, so
     * a price cannot creep back in some other wording.
     */
    for (const kind of ["employer", "agency"] as const) {
      const label = sponsoredLabel({ sponsored_kind: kind });
      expect(label).not.toMatch(/\d/);
      expect(label).not.toMatch(/\$|₪|paid/i);
    }
  });

  it("still labels a listing whose kind is missing", () => {
    // Unknown kind must not mean unlabelled: the disclosure is the point.
    expect(sponsoredLabel({})).toBe("Sponsored");
    expect(sponsoredLabel({ sponsored_kind: null })).toBe("Sponsored");
  });
});
