import { describe, it, expect } from "vitest";
import { isJobSeekerPost, isNotAVacancyPost, judgeSeekerPost } from "./seeker";

describe("isJobSeekerPost", () => {
  it("catches the post that got through", () => {
    expect(
      isJobSeekerPost("אני מחפשת משרה של 100% עבודה מהבית בלבד בצ'אט (ללא שירות לקוחות)"),
    ).toBe(true);
  });

  it("catches other ways people advertise themselves", () => {
    for (const t of [
      "מחפש עבודה בתחום ה QA, ניסיון של 3 שנים",
      "אני מחפש תפקיד חדש בפיתוח בק אנד",
      "פנויה לעבודה מיידית, קורות חיים מצורפים",
      "קורות חיים מצורפים, אשמח לשמוע על הזדמנויות",
      "Open to work — Senior Data Analyst, 5 years experience",
      "I'm looking for a new position in product marketing",
      "Available for work immediately, React and Node",
      "Seeking a new role as a DevOps engineer",
    ]) {
      expect(isJobSeekerPost(t), t).toBe(true);
    }
  });

  it("treats a plural 'we are looking' as hiring, not seeking", () => {
    // מחפשים is first-person PLURAL: a company, not a person. It must not fire
    // the seeker cue at all, veto or no veto.
    expect(judgeSeekerPost("מחפשים עבודה? שלחו קורות חיים").matched).toBeNull();
  });

  it("does not touch real openings", () => {
    for (const t of [
      "דרוש/ה מפתח/ת Full Stack לחברת סטארטאפ בתל אביב",
      "מגייסים מנהל/ת שיווק לחברה מובילה",
      "אנחנו מחפשים מפתח בק אנד לצוות המתרחב שלנו",
      "We're hiring a Senior Backend Engineer — Tel Aviv",
      "Join our team: QA Automation Engineer",
      "Now hiring: Product Manager, hybrid in Herzliya",
      "לצוות שלנו דרושה מעצבת UX/UI",
    ]) {
      expect(isJobSeekerPost(t), t).toBe(false);
    }
  });

  it("lets an explicit hiring cue veto an ambiguous post", () => {
    // A recruiter ADDRESSING job seekers: "looking for work? we need a
    // developer". The singular cue fires, but so does an explicit hiring cue,
    // and dropping a real opening is the worse failure — so hiring wins.
    const v = judgeSeekerPost("מחפש עבודה בהייטק? דרוש/ה מפתח Full Stack לחברה מובילה");
    expect(v.isSeeker).toBe(false);
    expect(v.vetoedBy).not.toBeNull();
  });

  it("ignores empty input", () => {
    expect(isJobSeekerPost("")).toBe(false);
    expect(isJobSeekerPost("   ")).toBe(false);
  });
});

describe("the two posts a user reported on the live site", () => {
  it("catches 'I am actively looking for my first opportunity'", () => {
    expect(
      isJobSeekerPost(
        "Hello LinkedIn network! 👋 I am actively looking for my first opportunity as a " +
          "Junior Java Developer / Junior Full Stack Developer. Over the past months I have " +
          "been focused on mastering modern web development and backend.",
      ),
    ).toBe(true);
  });

  it("catches a freelancer advertising services", () => {
    expect(
      isJobSeekerPost(
        "I am a professional website developer with 3 years of experience. I offer Services " +
          "for Clients 👇 • Custom Websites (Html, Css, JavaScript, React Js, Node Js, PHP, " +
          "Laravel, Mongo DB, MySQL) • WordPress Websites",
      ),
    ).toBe(true);
  });

  it("still does not touch an employer hiring a freelancer", () => {
    // "freelance" appears, but so does an unmistakable hiring cue.
    expect(
      isJobSeekerPost("דרוש/ה מפתח/ת פרילנסר לפרויקט של שלושה חודשים בתל אביב"),
    ).toBe(false);
    expect(isJobSeekerPost("We're hiring a freelance designer — apply here")).toBe(false);
  });
});

/*
 * The QA search report: "יש שם גם פוסטים של מכללות שזה בכלל לא קשור למשרה".
 *
 * A hiring group is also a forum. Every string below was taken from a row that
 * was live and open in the index when the report came in — the first one was
 * the TOP result for a search on "QA".
 */
describe("posts that are questions to the group, not vacancies", () => {
  const asked = [
    "תגידו מישהו שמע על לימודי תעודת הנדסאי Ai סייבר בשנקר? האם זה משהו שבאמת יכול לתרום",
    "היי לכולם, אני מתלבט אם להתחיל קורס של דאטה סיינטס/אנליסט במכללת אנליזה",
    "יש כאן כאלה שלמדו באקדמית אונו / המכללה האקדמית רמת גן מערכות מידע?",
    "האם מישהו כאן באמת הצליח? להחליף מזכירה בסוכן ai? אשמח שישתף כמה מילים, " +
      "אשמח לעזרה בתשלום בנושא",
    "לימודי דאטה אנליסט היי! לאחרונה עברתי אבחון תעסוקתי, אשמח לעזרה. תודה רבה!",
  ];

  for (const text of asked) {
    it(`drops: ${text.slice(0, 44)}…`, () => {
      const verdict = judgeSeekerPost(text);
      expect(verdict.isSeeker, text).toBe(true);
      expect(verdict.kind, text).toBe("discussion");
    });
  }
});

describe("a school selling a course is not a vacancy", () => {
  /*
   * The post that ranked FIRST for a search on "QA". A school's success story,
   * closing with an invitation — reported as "פוסטים של מכללות שזה בכלל לא
   * קשור למשרה", and the reason this class exists.
   */
  it("drops the bootcamp success story that topped the QA search", () => {
    const verdict = judgeSeekerPost(
      "איך מגיעים משינוי קריירה בגיל 30+ ל-QA ואיך חוזרים ל-QA אחרי קיצוצים? הרבה אנשים " +
        "שחולמים להיכנס לתחום בדיקות התוכנה בטוחים שחובה להגיע עם רקע טכנולוגי עמוק. " +
        "כשהיא הגיעה אלינו למכללה לאוטומציה, הכל השתנה.",
    );
    expect(verdict.isSeeker).toBe(true);
    expect(verdict.kind).toBe("course_ad");
  });

  it("drops a QA interview simulation", () => {
    const verdict = judgeSeekerPost(
      "סימולציית QA: אתם משחקים בפעם הראשונה במשחק מובייל ונפסלים לאחר שצברתם 80 נקודות",
    );
    expect(verdict.isSeeker).toBe(true);
    expect(verdict.kind).toBe("course_ad");
  });

  it("drops an enrolment advert", () => {
    expect(isNotAVacancyPost("נפתחה ההרשמה למחזור הקרוב, מלגות למצטיינים")).toBe(true);
  });

  /*
   * The words a course advert uses are the words real vacancies use. Each of
   * these was open in the index at the same time as the adverts above, and all
   * four must survive, so `קורס`, `הכשרה`, `לימודים` and `קריירה` are
   * deliberately not cues on their own.
   */
  it("keeps real jobs that happen to be about courses", () => {
    const kept = [
      "דרוש /ה מדריך /ת QA ובדיקות תוכנה, להעברת תכנים מקצועיים בקורס פרונטלי",
      "מגייסת אנשי מכירות לעבודה מהבית במכירות קורסים, משרה מלאה, לידים חמים",
      "רוצה לבנות לעצמך קריירה ניהולית? קבוצת שפיר מגייסת למסלול הכשרה ניהולית",
      "מגייס אנשי מכירות למוקד טלפוני של לימודי יזמות ברמת החייל",
      "🚀 הזדמנות מעולה להזניק את הקריירה בעולמות ה-IT! חברה מובילה וצומחת בתל אביב " +
        "מחפשת Junior System Administrator. תיאור התפקיד: תחזוקה ופיתוח תשתיות",
    ];
    for (const text of kept) {
      expect(isNotAVacancyPost(text), text).toBe(false);
    }
  });
});

/*
 * Found by sweeping the gate over all 1,000 open Facebook rows rather than by
 * imagining cases. The old freelance cue matched the word פרילנסר wherever it
 * stood, so an employer hiring one looked exactly like a freelancer touting.
 */
describe("hiring a freelancer, versus being one", () => {
  it("keeps the two real openings the sweep caught", () => {
    expect(
      isNotAVacancyPost("מחפשות מנהלת סושיאל פרילנסרית לעבודה קבועה ולטווח ארוך"),
    ).toBe(false);
    expect(
      isNotAVacancyPost("היי אני מחפשת פרילנסר/ית עם 1-2 שנות ניסיון בעיצוב מוצר / UX/UI"),
    ).toBe(false);
  });

  it("still drops a freelancer touting for work", () => {
    expect(
      isNotAVacancyPost("אני פרילנסרית שנותנת שירותי הנה״ח בשליטה מרחוק, בעלת משרד בחדרה"),
    ).toBe(true);
    expect(
      isNotAVacancyPost("היי לכולם, אני אוהד, איש SEO פרילנסר עם מעל 13 שנות ניסיון, וזמין"),
    ).toBe(true);
  });
});

describe("looking for opportunities counts as looking for work", () => {
  it("catches מחפשת הזדמנויות חדשות", () => {
    expect(isNotAVacancyPost("כותבת תוכן ואשת seo מנוסה מחפשת הזדמנויות חדשות")).toBe(true);
  });
});

/*
 * Three seeker posts reported as live listings on the same morning. Each one
 * had a first-person verb the cue list already knew and a noun it did not, or
 * a word between them.
 */
describe("seeker posts that the noun list used to walk past", () => {
  it("catches פנוי לתפקיד — the list was only עבודה and משרה", () => {
    const v = judgeSeekerPost(
      "פנוי לתפקיד חדש — מהנדס רשתות ואבטחת מידע\nאני מהנדס רשתות ואבטחת מידע " +
        "(Network & Cybersecurity Engineer) עם כ-3 שנות ניסיון מעשי",
    );
    expect(v.isSeeker).toBe(true);
    expect(v.kind).toBe("seeker");
  });

  it("allows words between the verb and the noun", () => {
    // "מחפש AT THE opportunity" — the verb and noun were required adjacent.
    expect(
      isNotAVacancyPost(
        "היי לכולם 👋\nאני מיכאל, מחפש את ההזדמנות הראשונה שלי להשתלב בעולם ההייטק, בתפקיד Junior",
      ),
    ).toBe(true);
    expect(
      isNotAVacancyPost("אני מהנדס רשתות ומחפש כעת את התפקיד הבא שלי: NOC Engineer"),
    ).toBe(true);
    expect(
      isNotAVacancyPost("היי לכולם, אני שירתאל, ובימים האלה אני מחפשת את המקום הבא שלי"),
    ).toBe(true);
  });
});

/*
 * Marketing and thought-leadership. Both of these decompose perfectly — the
 * first tags as security, the second as security and AI — because they are
 * ABOUT the field. Neither offers a job.
 */
describe("content posts are not vacancies", () => {
  it("catches a webinar promoted to business owners", () => {
    const v = judgeSeekerPost(
      "אם מחר בבוקר העסק שלכם ייקלע לאירוע סייבר - האם הוא ערוך להתמודד איתו?\n" +
        "בוובינר הקרוב, רועי שגב, מייסד ומנכ\"ל הבית הישראלי לביטוחי סייבר, יעשה סדר",
    );
    expect(v.isSeeker).toBe(true);
    expect(v.kind).toBe("content_post");
  });

  it("catches a podcast episode framed as an industry question", () => {
    const v = judgeSeekerPost(
      "How is AI changing cybersecurity, and what does that mean for the modern CISO?\n" +
        "In Part 2 of this Root to CISO conversation, the panel continue the journey.",
    );
    expect(v.isSeeker).toBe(true);
    expect(v.kind).toBe("content_post");
  });

  it("does not mistake a hiring hook for an article", () => {
    // Addressed to the reader as a candidate, not asking about the field.
    expect(isNotAVacancyPost("רוצה לעבוד בהייטק? דרוש/ה מפתח/ת Full Stack")).toBe(false);
    expect(isNotAVacancyPost("Looking for your next role? We're hiring a Backend Engineer")).toBe(
      false,
    );
  });
});

/*
 * The structural signal behind every cue above.
 *
 * A cue list is only ever as good as the last bug report; this is the thing
 * the reports have in common. Somebody describing themselves says "I" and "my"
 * repeatedly and never says "we".
 */
describe("first-person density, as the catch-all", () => {
  it("catches a self-description with no cue phrase in it at all", () => {
    const v = judgeSeekerPost(
      "שלום לכולם\nסיימתי לאחרונה תואר במדעי המחשב. יש לי רקע בפרויקטים אישיים, " +
        "והידע שלי כולל Java ו-Python. אשמח אם תוכלו לעזור לי.",
    );
    expect(v.isSeeker).toBe(true);
    expect(v.matched).toContain("first-person density");
  });

  it("does NOT catch a founder hiring in the first person", () => {
    /*
     * The one false positive a sweep over all 2,047 open social rows turned
     * up: a studio owner, writing entirely in the singular because there is
     * only one of her, advertising a real job.
     */
    expect(
      isNotAVacancyPost(
        "מחפשת מעצב/ת פנים להצטרף אליי לסטודיו 🤍\nהסטודיו שלי מתמחה בתכנון מחדש של בתים קיימים. " +
          "אני מחפשת מישהו/י שייכנס איתי לפרויקטים, חשובים לי ידע טוב ב-AutoCAD",
      ),
    ).toBe(false);
  });

  it("does NOT catch an employer, who says we", () => {
    expect(
      isNotAVacancyPost(
        "אני מגייסת עבור החברה שלנו מפתח/ת Backend. אנחנו צוות של 20 ואנחנו מחפשים מישהו שיצטרף אלינו.",
      ),
    ).toBe(false);
  });

  it("needs three markers, so one stray אני is not enough", () => {
    expect(isNotAVacancyPost("דרוש/ה מפתח/ת Python. אני זמינה לשאלות במסרים.")).toBe(false);
  });
});

describe("classified ads in hiring groups", () => {
  // Real titles that were live on the site, reported 2026-09-14.
  const ADS = [
    "להשכרה",
    "📍 להשכרה | דירת קרקע מקסימה בקרית שלום – רחוב צונזר",
    "להשכרה ברחוב החשמל, צמוד לדרך מנחם בגין, חניה",
    "להשכרה בנווה איילון, אור יהודה",
    "נכס יוקרה להשכרה",
    "שימו ❤️ דירת גג ענקית למכירה ברחוב נורדאו",
    "למכירה דירת 3 חדרים במיקום מבוקש במודיעין",
    "5 חדרים עם ממ״ד, מרפסת סוכה וחניה פרטית",
    "מיני פנטהאוז יוקרתי למכירה בנהריה",
    "למכירה סוויץ' NETGEAR GS108PP חדש לחלוטין",
    "Apartment for rent in Tel Aviv, 3 rooms",
  ];
  for (const t of ADS) {
    it(`drops: ${t.slice(0, 34)}`, () => {
      expect(judgeSeekerPost(t).kind).toBe("classified_ad");
    });
  }

  /*
   * The other half of the job. A sales role is a real vacancy and the word for
   * "sales" shares a root with "for sale"; a rental-property COMPANY hiring is
   * still hiring. If any of these start failing, the cues have grown too broad.
   */
  const REAL = [
    "דרוש/ה מנהל/ת מכירות לחברת הייטק",
    "מחפשים נציג מכירות B2B",
    "Sales Manager for a SaaS company",
    "דרוש/ה מפתח/ת Full Stack לחברת נדל״ן",
    "Real Estate Analyst wanted for proptech startup",
    "דרוש/ה סוכן/ת נדל״ן למשרד תיווך",
  ];
  for (const t of REAL) {
    it(`keeps: ${t.slice(0, 34)}`, () => {
      expect(judgeSeekerPost(t).kind).not.toBe("classified_ad");
    });
  }
});
