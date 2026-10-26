import { describe, expect, it } from "vitest";
import { socialTitle } from "./social-title";

describe("socialTitle", () => {
  it("keeps a short role line as-is", () => {
    expect(socialTitle("AI Agent Engineer רמת גן")).toBe("AI Agent Engineer רמת גן");
  });

  it("cuts at the first line break", () => {
    expect(socialTitle("Backend Developer\nאנחנו מחפשים מפתח")).toBe("Backend Developer");
  });

  it("cuts a long opening at the Hebrew clause break", () => {
    const post =
      "דרוש/ה QA & Automation Engineer לפרויקט ביטחוני בעל חשיבות לאומית אנחנו מחפשים QA Engineer מנוסה";
    const t = socialTitle(post);
    expect(t.length).toBeLessThanOrEqual(70);
    expect(t).toContain("QA & Automation Engineer");
    expect(t).not.toContain("מחפשים");
  });

  it("never exceeds the cap and never breaks mid-word", () => {
    const long = "מפתח ".repeat(40);
    const t = socialTitle(long);
    expect(t.length).toBeLessThanOrEqual(70);
    expect(t.endsWith(" ")).toBe(false);
  });

  it("strips leading bullets and emoji-ish junk", () => {
    expect(socialTitle("*** Senior Data Engineer")).toBe("Senior Data Engineer");
  });

  it("handles an empty post without throwing", () => {
    expect(socialTitle("")).toBe("");
  });
});

describe("socialTitle formatting", () => {
  it("strips markdown-style emphasis asterisks", () => {
    expect(socialTitle("**דרוש/ה מפתח/ת SQL מנוסה** **עבודה בחיפה**")).toBe(
      "דרוש/ה מפתח/ת SQL מנוסה עבודה בחיפה",
    );
  });

  it("strips a decorative leading emoji", () => {
    expect(socialTitle("🔹️ דרוש/ה מפתח/ת Full-Stack Web")).toBe("דרוש/ה מפתח/ת Full-Stack Web");
    expect(socialTitle("🔥 דרוש/ה מפתח/ת אוטומציה RPA")).toBe("דרוש/ה מפתח/ת אוטומציה RPA");
  });

  it("collapses the whitespace left behind by stripping", () => {
    expect(socialTitle("**Senior**   **Data Engineer**")).toBe("Senior Data Engineer");
  });

  it("leaves no trailing punctuation after truncation", () => {
    const t = socialTitle("**" + "מפתח ".repeat(30) + "**");
    expect(t.length).toBeLessThanOrEqual(70);
    expect(/[\s*\-–—:]$/.test(t)).toBe(false);
  });
});

describe("socialTitle on LinkedIn roundups", () => {
  it("cuts a multi-role hiring post down to its opening", () => {
    const t = socialTitle(
      "We're hiring at Sentra 🚀 🇮🇱 Israel (Tel Aviv) • Senior Product Manager • Software Architect • Senior Backend Engineer • Data Engineer. Apply through the links below.",
    );
    expect(t.length).toBeLessThanOrEqual(70);
    expect(t).not.toContain("Software Architect");
  });

  it("keeps a normal role line intact", () => {
    expect(socialTitle("Senior DevOps Engineer")).toBe("Senior DevOps Engineer");
  });

  it("cuts at the recruiting verb in Hebrew", () => {
    const t = socialTitle(
      "מהנדס/ת תוכנה Full Stack אנחנו מחפשים מפתח/ת מנוסה לצוות שלנו בתל אביב עם ניסיון של חמש שנים",
    );
    expect(t.length).toBeLessThanOrEqual(70);
    expect(t).toContain("Full Stack");
  });
});

/*
 * Reported as "ראיתי שיש משרה חדשה אבל אין כותרת, לא ברור מה זה" — a card
 * headed "משרה חדשה", which means "new job" and names nothing.
 *
 * One recruiter posts to a fixed template with the label on line one and the
 * role two lines down. 45 open rows carried a role-less title when this was
 * written, 40 of them from that single template.
 */
describe("an opening line that announces a job without naming one", () => {
  it("takes the role from the body", () => {
    expect(
      socialTitle(
        "משרה חדשה\n\nDevSecOps Engineer\n\nכל הפרטים וההגשה כאן:\n\nhttps://example.com/job/1",
      ),
    ).toBe("DevSecOps Engineer");
  });

  it("steps over a qualifier line to reach the role", () => {
    expect(
      socialTitle(
        "משרה חדשה\n\nאין צורך בניסיון קודם\n\nGame Developer\n\nכל הפרטים וההגשה כאן:\n\nhttps://x.co/1",
      ),
    ).toBe("Game Developer");
  });

  it("handles the English variants of the label", () => {
    expect(socialTitle("We're Hiring\n\nSenior Backend Engineer\n\nApply here")).toBe(
      "Senior Backend Engineer",
    );
  });

  /*
   * The label is poor; a sentence lifted from the middle of the post is worse.
   * Each of these was produced by an earlier version of the fix and rejected
   * on the evidence of a sweep over every open social row.
   */
  it("keeps the label rather than promoting something that is not a role", () => {
    // A bare location — the post puts the city on its own line.
    expect(socialTitle("WE'RE HIRING\n\nTel Aviv\n\nFull time")).toBe("WE'RE HIRING");
    // A question is never a title.
    expect(socialTitle("We are hiring\n\nמה אנחנו מחפשים?\n\nניסיון")).toBe("We are hiring");
    // A section heading, one word, that names no role. The clock matters:
    // U+23F0 was outside the emoji range, so "⏰ Shifts" counted as two words
    // and slipped past the single-word check.
    expect(socialTitle("WE'RE HIRING\n\n⏰ Shifts\n\nSunday to Thursday")).toBe("WE'RE HIRING");
    // A requirement, not a role.
    expect(socialTitle("We're Hiring\n\n3+ שנות ניסיון בפיתוח\n\nמיקום: תל אביב")).toBe(
      "We're Hiring",
    );
    // A duty.
    expect(socialTitle("מגייסת\n\nטיפול בשכר מורכב ומגוון\n\nדרישות")).toBe("מגייסת");
  });

  it("does not touch a first line that already names a role", () => {
    expect(socialTitle("משרה חדשה: Data Engineer\n\nכל הפרטים")).toBe("משרה חדשה: Data Engineer");
    expect(socialTitle("דרוש/ה QA Engineer\n\nלחברה מובילה")).toBe("דרוש/ה QA Engineer");
  });
});
