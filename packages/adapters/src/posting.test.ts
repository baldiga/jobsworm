import { describe, expect, it } from "vitest";
import {
  buildPostedJobRow,
  looksLikeClientWork,
  sameOrganisation,
  type PostingInput,
} from "./posting";

const BACKEND = `
We are hiring a Senior Backend Engineer to join our platform team in Tel Aviv.

Requirements:
- 5+ years of experience building backend services in Python or Go
- Strong SQL and experience with PostgreSQL
- Experience with Kubernetes and AWS
- Hebrew and English

Nice to have:
- Kafka
- Experience with high-scale distributed systems

We offer a hybrid arrangement, three days a week in the office.
`.trim();

function input(over: Partial<PostingInput> = {}): PostingInput {
  return {
    campaignId: "11111111-1111-1111-1111-111111111111",
    kind: "employer",
    plan: "sponsored",
    postedBy: "22222222-2222-2222-2222-222222222222",
    recruiterEmail: "hr@acme.example",
    title: "Senior Backend Engineer",
    companyName: "Acme Systems",
    descriptionText: BACKEND,
    locationRaw: "Tel Aviv",
    applyUrl: "https://acme.example/careers/backend",
    salaryMin: 25000,
    salaryMax: 35000,
    ...over,
  };
}

describe("buildPostedJobRow", () => {
  it("decomposes a real posting into a draft row", () => {
    const { row, reject } = buildPostedJobRow(input());
    expect(reject).toBeNull();
    expect(row).toBeTruthy();
    expect(row!.status).toBe("draft");
    expect(row!.title_raw).toBe("Senior Backend Engineer");
    expect(row!.function).toBe("software_engineering");
    expect(row!.skills_required).toContain("python");
    expect(row!.source_provider).toBe("employer");
    expect(row!.source_external_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("never publishes on creation: draft, no expiry, no posted_at", () => {
    const { row } = buildPostedJobRow(input());
    expect(row!.status).toBe("draft");
    expect(row!.expires_at).toBeNull();
    expect(row!.posted_at).toBeNull();
  });

  it("forces is_agency from who is buying, not from the text", () => {
    // Identical copy, two buyers. The account decides.
    const employer = buildPostedJobRow(input({ kind: "employer" }));
    const agency = buildPostedJobRow(input({ kind: "agency" }));
    expect(employer.row!.is_agency).toBe(false);
    expect(agency.row!.is_agency).toBe(true);
    expect(agency.row!.source_provider).toBe("agency");
  });

  it("flags an employer who writes like an agency, and leaves is_agency alone", () => {
    const { row, flags } = buildPostedJobRow(
      input({ descriptionText: `Our client, a leading fintech, is hiring.\n\n${BACKEND}` }),
    );
    expect(flags).toContain("looks_like_agency");
    // Flagged for a person to read. NOT reclassified: that would remove a
    // paying employer from organic search without telling them.
    expect(row!.is_agency).toBe(false);
  });

  it("refuses a non-tech vacancy rather than taking the money", () => {
    const { row, reject } = buildPostedJobRow(
      input({
        title: "Plumber",
        descriptionText:
          "We are looking for an experienced plumber to handle residential " +
          "callouts across the Sharon area. You will fit and repair pipework, " +
          "diagnose leaks and install sanitary fittings. A driving licence and " +
          "your own tools are required. Five years on the tools preferred. " +
          "Work is scheduled daily from our Netanya office and you will be " +
          "paid per callout with a monthly guarantee.",
      }),
    );
    expect(reject).toBe("non_tech");
    expect(row).toBeNull();
  });

  it("refuses a job that is not in Israel", () => {
    const { reject } = buildPostedJobRow(
      input({
        title: "Senior Backend Engineer",
        locationRaw: "Berlin, Germany",
        descriptionText: BACKEND.replace("Tel Aviv", "Berlin, Germany"),
      }),
    );
    expect(reject).toBe("abroad");
  });

  it("refuses a description too short to be a real listing", () => {
    const { reject } = buildPostedJobRow(input({ descriptionText: "Backend dev wanted." }));
    expect(reject).toBe("too_short");
  });

  it("stores no HTML, ever", () => {
    const { row } = buildPostedJobRow(
      input({ descriptionText: `<script>alert(1)</script>\n${BACKEND}` }),
    );
    // The column a renderer would trust is null; the text column is text.
    expect(row!.description_html).toBeNull();
    expect(typeof row!.description_text).toBe("string");
  });

  it("recognises an email apply route and normalises it to mailto:", () => {
    const { row } = buildPostedJobRow(input({ applyUrl: "jobs@acme.example" }));
    expect(row!.apply_method).toBe("email");
    expect(row!.apply_url).toBe("mailto:jobs@acme.example");

    const already = buildPostedJobRow(input({ applyUrl: "mailto:jobs@acme.example" }));
    expect(already.row!.apply_url).toBe("mailto:jobs@acme.example");
  });

  it("stores the employer's own salary range, not one guessed from the prose", () => {
    const { row } = buildPostedJobRow(input({ salaryMin: "₪25,000", salaryMax: "35000" }));
    expect(row!.salary).toEqual({
      min: 25000,
      max: 35000,
      currency: "ILS",
      period: "month",
      source: "employer",
    });
  });

  it("refuses a listing with no salary, and says which mistake was made", () => {
    expect(buildPostedJobRow(input({ salaryMin: null, salaryMax: null })).reject).toBe(
      "salary:missing",
    );
    expect(buildPostedJobRow(input({ salaryMin: 2000, salaryMax: 4000 })).reject).toBe(
      "salary:below_minimum",
    );
    // An annual package typed into the monthly field.
    expect(buildPostedJobRow(input({ salaryMin: 300000, salaryMax: 420000 })).reject).toBe(
      "salary:above_maximum",
    );
  });

  it("flags, rather than refuses, a figure in the executive band", () => {
    /*
     * ₪110,000 a month is legal, rare, and plausible for an executive — and
     * also what somebody might type meaning something else. Both readings are
     * possible here, unlike above the ceiling, so it goes up with a flag and
     * the form asks.
     */
    const { row, reject, flags } = buildPostedJobRow(
      input({ salaryMin: 110000, salaryMax: 140000 }),
    );
    expect(reject).toBeNull();
    expect(flags).toContain("salary_check_monthly");
    expect(row!.salary).toMatchObject({ min: 110000, period: "month" });

    // An ordinary range carries no such flag.
    expect(buildPostedJobRow(input()).flags).not.toContain("salary_check_monthly");
  });

  it("keeps total compensation in its own column, never folded into base", () => {
    const { row } = buildPostedJobRow(
      input({ totalCompMin: 450000, totalCompMax: 600000, totalCompPeriod: "year" }),
    );
    expect(row!.salary).toMatchObject({ min: 25000, max: 35000, period: "month" });
    expect(row!.total_comp).toMatchObject({ min: 450000, max: 600000, period: "year" });
  });

  it("keeps only catalogue benefits, in catalogue order", () => {
    const { row } = buildPostedJobRow(
      input({ benefits: ["parking", "free_beer", "equity_rsu", "sick_leave_day_one"] }),
    );
    expect(row!.benefits).toEqual(["equity_rsu", "sick_leave_day_one", "parking"]);
  });

  describe("the free tier", () => {
    it("publishes an employer's free listing like any other draft", () => {
      const { row, reject } = buildPostedJobRow(input({ plan: "free" }));
      expect(reject).toBeNull();
      expect(row!.status).toBe("draft");
    });

    it("refuses an agency outright", () => {
      // Organic search is agency-free, and a free listing IS organic. This is
      // the only route that would go around that promise.
      expect(buildPostedJobRow(input({ plan: "free", kind: "agency" })).reject).toBe(
        "agency_cannot_post_free",
      );
      // The same agency may still buy a labelled sponsored slot.
      expect(buildPostedJobRow(input({ plan: "sponsored", kind: "agency" })).reject).toBeNull();
    });

    it("requires a free listing to send applications to its own domain", () => {
      const offsite = buildPostedJobRow(
        input({ plan: "free", applyUrl: "https://collect-cvs.example/form" }),
      );
      expect(offsite.reject).toBe("apply_domain_mismatch");

      const ownEmail = buildPostedJobRow(input({ plan: "free", applyUrl: "jobs@acme.example" }));
      expect(ownEmail.reject).toBeNull();

      const subdomain = buildPostedJobRow(
        input({ plan: "free", applyUrl: "https://careers.acme.example/backend" }),
      );
      expect(subdomain.reject).toBeNull();
    });

    it("lets a PAID listing apply anywhere, because a person reads it first", () => {
      const { reject } = buildPostedJobRow(
        input({ plan: "sponsored", applyUrl: "https://boards.greenhouse.io/acme/jobs/1" }),
      );
      expect(reject).toBeNull();
    });
  });

  it("hashes content stably, and ignores the fields that change every pass", () => {
    const a = buildPostedJobRow(input()).row!;
    const b = buildPostedJobRow(input()).row!;
    // last_seen_at differs between the two calls; the hash must not.
    expect(a.content_hash).toBe(b.content_hash);
    const changed = buildPostedJobRow(input({ title: "Staff Backend Engineer" })).row!;
    expect(changed.content_hash).not.toBe(a.content_hash);
  });
});

describe("looksLikeClientWork", () => {
  it("catches the phrases only a third party writes", () => {
    expect(looksLikeClientWork("Our client is hiring a DevOps engineer")).toBe(true);
    expect(looksLikeClientWork("Posting on behalf of a Series B startup")).toBe(true);
    expect(looksLikeClientWork("הלקוח שלנו מחפש מפתח בקאנד")).toBe(true);
  });

  it("leaves ordinary employer copy alone", () => {
    expect(looksLikeClientWork("We are hiring a backend engineer for our platform team")).toBe(
      false,
    );
    // "client" in its ordinary technical sense must not trip it.
    expect(looksLikeClientWork("You will build our client-side SDK and API clients")).toBe(false);
  });
});

describe("sameOrganisation", () => {
  it("accepts a subdomain of the same registrable domain", () => {
    expect(sameOrganisation("acme.com", "careers.acme.com")).toBe(true);
    expect(sameOrganisation("acme.com", "www.acme.com")).toBe(true);
    expect(sameOrganisation("acme.co.il", "jobs.acme.co.il")).toBe(true);
  });

  it("rejects a lookalike", () => {
    expect(sameOrganisation("acme.com", "acme-jobs.net")).toBe(false);
    expect(sameOrganisation("acme.co.il", "evil.com")).toBe(false);
  });

  it("does not treat two co.il domains as the same organisation", () => {
    // The failure a naive last-two-labels comparison makes: "co.il" carries no
    // identity, so every Israeli company would match every other one.
    expect(sameOrganisation("acme.co.il", "other.co.il")).toBe(false);
  });
});
