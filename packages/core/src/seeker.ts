/**
 * Telling "I am looking for work" apart from "we are looking for someone".
 *
 * A hiring group carries both. People post their own availability into the same
 * feed recruiters post openings into, and to a scraper the two look identical:
 * Hebrew, a job title, a location, a salary expectation. One of them turned up
 * on the site as a listing —
 *
 *   אני מחפשת משרה של 100% עבודה מהבית בלבד בצ'אט (ללא שירות לקוחות)
 *
 * — classified as Solutions engineering, ₪50+/month, Remote, Part-time. Every
 * field was extracted correctly. It simply was not a job.
 *
 * ## The distinction is grammatical, not topical
 *
 * Both kinds of post are about a job, mention a title, and say "מחפש". What
 * separates them is WHO is looking:
 *
 *   אני מחפשת משרה     I am looking for a position        seeker
 *   מחפשים מפתח        we are looking for a developer     hiring
 *   דרוש/ה מפתח        a developer is wanted              hiring
 *
 * So the seeker cues below are all first-person-singular, or they are the
 * unmistakable furniture of a personal availability post ("קורות חיים
 * מצורפים", "open to work"). Anything that merely mentions a job is not enough.
 *
 * ## When both appear, hiring wins
 *
 * A recruiter writing "מחפשים אנשים שמחפשים עבודה" would trip a seeker cue.
 * Dropping a real opening is a worse failure than keeping one stray seeker
 * post, so an explicit hiring cue vetoes the seeker verdict.
 */

/*
 * A note on word boundaries, because this cost a round of failing tests.
 *
 * JavaScript's \b is defined on ASCII word characters only. Every Hebrew
 * letter is a non-word character to it, so `/\bאני\b/` never matches the way
 * it reads — the boundary it asks for does not exist between a space and 'א'.
 * Hebrew patterns therefore use an explicit edge: start of string, whitespace,
 * or punctuation. `\b` is kept only in the English cues, where it works.
 */
const EDGE = String.raw`(?:^|[\s|·,.!?()\-–—:"'״])`;

/** First-person availability. The subject is the writer, not a vacancy. */
const SEEKER_CUES: RegExp[] = [
  /*
   * מחפש/ת עבודה — with room for what Hebrew actually puts in between.
   *
   * The verb and the noun used to have to be adjacent, which is not how people
   * write. All three of these were reported as live listings:
   *
   *   מחפש את ההזדמנות הראשונה שלי להשתלב בעולם ההייטק
   *   ומחפש כעת את התפקיד הבא שלי
   *   אני מחפשת את המקום הבא שלי
   *
   * — "את", "את ה", "כעת את ה". So the gap allows a couple of short words,
   * and the noun list gained the construct forms (משרת, עבודת) and the words
   * people actually use for a next job (מקום, אתגר, הזדמנות).
   */
  /*
   * The `(?:ו|ש|כש)?` prefix is not decoration. Hebrew glues its conjunctions
   * onto the front of the word, so "ומחפש כעת את התפקיד הבא שלי" begins with
   * ו‑ and EDGE — which wants a space or punctuation before the verb — never
   * matched it. Same family of trap as \b not working on Hebrew at all.
   */
  new RegExp(
    EDGE +
      String.raw`(?:ו|ש|כש)?(?:מחפש|מחפשת|מחפשים\s+לי)\s+(?:כעת\s+|כרגע\s+|היום\s+)?(?:את\s+)?(?:ה)?` +
      String.raw`(?:עבודה|עבודת|משרה|משרת|תפקיד|התמחות|הזדמנות|הזדמנויות|מקום|אתגר)`,
    "u",
  ),
  /*
   * אני זמין/ה · פנוי/ה לתפקיד
   *
   * The noun list used to be only עבודה|משרה, so "פנוי לתפקיד חדש — מהנדס
   * רשתות ואבטחת מידע" walked straight through and was published as a job.
   * Reported.
   */
  new RegExp(
    EDGE +
      String.raw`(?:אני\s+)?(?:זמין|זמינה|פנוי|פנויה)\s+(?:ל|ב)?(?:עבודה|משרה|משרת|תפקיד|התמחות|הזדמנות|אתגר)`,
    "u",
  ),
  // קורות חיים מצורפים · קו"ח מצ"ב
  new RegExp(String.raw`(?:קורות\s+חיים|קו"ח|קו״ח)\s*(?:מצורפים|מצורף|מצ"ב|מצ״ב)`, "u"),
  new RegExp(EDGE + String.raw`(?:מצרף|מצרפת)\s+(?:את\s+)?(?:קורות\s+חיים|קו"ח|קו״ח)`, "u"),
  // אשמח לשמוע על הזדמנויות
  new RegExp(EDGE + String.raw`אשמח\s+(?:לשמוע|לקבל)\s+(?:על\s+)?(?:הזדמנויות|הצעות|משרות)`, "u"),
  // English — \b works here, because these are ASCII.
  //
  // The adverb and the adjectives are deliberately loose. A reported miss was
  // "I am actively looking for my first opportunity as a Junior Java
  // Developer": "actively" was not in the adverb list and "first" was not in
  // the adjective list, so a textbook seeker post sailed through. The
  // first-person subject is what makes this safe to loosen — "we are looking
  // for a talented backend developer" never starts with "I am".
  /\bopen\s+to\s+work\b/i,
  /\b(?:i\s*(?:'|’)?m|i\s+am)\s+(?:\w+ly\s+)?(?:looking|searching)\s+for\s+(?:\w+\s+){0,3}?(?:job|position|role|opportunit|internship)/i,
  /\b(?:i\s*(?:'|’)?m|i\s+am)\s+(?:currently\s+)?(?:available|seeking)\b/i,
  /\blooking\s+for\s+(?:my\s+)?(?:first|next|new)\s+(?:\w+\s+){0,2}?(?:job|role|position|opportunit|challenge)/i,
  /\bavailable\s+for\s+(?:work|hire|new\s+opportunit)/i,
  /\bseeking\s+(?:a\s+)?(?:new\s+)?(?:job|position|role)\b/i,
];

/**
 * The other kind of non-job: somebody selling their own services.
 *
 * "I am a professional website developer with 3 years of experience. I offer
 * Services for Clients 👇 Custom Websites…" is not a person looking for a job
 * and not a vacancy either — it is an advert for a freelancer. It decomposes
 * beautifully (React, Node, PHP, Laravel all land in tech_stack) and it was
 * reported on the site as a listing.
 *
 * Kept separate from SEEKER_CUES because the giveaway is different: not "I
 * want work" but "I sell work". Same veto applies.
 */
const FREELANCE_AD_CUES: RegExp[] = [
  /\bi\s+(?:am|'m|’m)\s+a\s+(?:professional|freelance|freelancer|certified|experienced)\b/i,
  /\bi\s+(?:offer|provide)\s+(?:my\s+|the\s+)?(?:services|service|work)\b/i,
  /\bmy\s+services\s+(?:include|are|for)\b/i,
  /\bservices\s+for\s+clients\b/i,
  /\bhire\s+me\b/i,
  /\b(?:available|open)\s+for\s+(?:freelance|projects|part[- ]time\s+projects)\b/i,
  /*
   * First person REQUIRED, and this is why.
   *
   * The cue used to be a bare `(?:אני\s+)?פרילנסר`, which matched the word
   * wherever it stood — including in "מחפשות מנהלת סושיאל פרילנסרית לעבודה
   * קבועה" and "אני מחפשת פרילנסר/ית עם 1-2 שנות ניסיון". Both of those are
   * somebody HIRING a freelancer, and a sweep over 1,000 open posts caught
   * both as freelance adverts. Dropping a real opening is the worse failure,
   * so the subject now has to be the writer.
   *
   * The gap allows "אני אוהד, איש SEO פרילנסר" — people introduce themselves
   * before they get to the noun. It also lets "אני מחפשת פרילנסר" back in,
   * which is what the matching hiring cue below is for.
   */
  new RegExp(EDGE + String.raw`אני\s+(?:\S+\s+){0,3}?(?:פרילנסר|פרילנסרית)`, "u"),
  new RegExp(EDGE + String.raw`(?:מציע|מציעה)\s+(?:את\s+)?(?:שירותי|שירותים)`, "u"),
];

/**
 * Somebody asking the group a question.
 *
 * A hiring group is also a forum, and the forum posts decompose just as well
 * as the vacancies — they name a role, a school, a salary. Searching "QA"
 * returned this as the top result:
 *
 *   איך מגיעים משינוי קריירה בגיל 30+ ל-QA ואיך חוזרים ל-QA אחרי קיצוצים
 *
 * and, a few rows down, "יש כאן כאלה שלמדו באקדמית אונו?" and "אני מתלבט אם
 * להתחיל קורס של דאטה סיינטס". None of them is a job. It was reported as
 * "פוסטים של מכללות שזה בכלל לא קשור למשרה", which is exactly right.
 *
 * The giveaway is the second person: a question aimed at the readers. A
 * vacancy addresses a candidate, never the room.
 */
const DISCUSSION_CUES: RegExp[] = [
  // מישהו שמע / יודע / מכיר · מישהי יודעת
  new RegExp(EDGE + String.raw`מישה(?:ו|י)\s+(?:שמע|שמעה|יודע|יודעת|מכיר|מכירה|התנסה)`, "u"),
  /*
   * יש כאן כאלה ש… · יש למישהו ניסיון
   *
   * Narrow on purpose. A bare "יש כאן" is not a cue: a vacancy writes "יש כאן
   * הזדמנות" and "יש כאן צוות מעולה" without asking anybody anything. What
   * makes this a question is the indefinite person being sought — כאלה, מישהו,
   * מי — so the pattern requires one.
   */
  new RegExp(EDGE + String.raw`יש\s+(?:כאן|פה)\s+(?:כאלה|מישהו|מישהי|מי\s+ש)`, "u"),
  new RegExp(EDGE + String.raw`יש\s+למיש(?:הו|הי)\s+(?:ניסיון|המלצה|מושג|רעיון)`, "u"),
  // אני מתלבט/ת · התלבטות
  new RegExp(EDGE + String.raw`(?:אני\s+)?מתלבט(?:ת|ים)?(?![֐-׿])`, "u"),
  new RegExp(EDGE + String.raw`התלבטות(?![֐-׿])`, "u"),
  // אשמח לשמוע אם / מה / מכם · אשמח לעזרה · אשמח להמלצות
  new RegExp(EDGE + String.raw`אשמח\s+(?:לשמוע|לדעת)\s+(?:אם|מה|האם|כאן|מכם|מאנשים|חוות)`, "u"),
  new RegExp(EDGE + String.raw`אשמח\s+(?:לעזרה|לעצה|לעצות|להמלצות|להכוונה)`, "u"),
  // מה עדיף · מה דעתכם · מה אתם ממליצים
  new RegExp(EDGE + String.raw`מה\s+(?:עדיף|דעתכם|דעתכן|אתם\s+(?:חושבים|ממליצים))`, "u"),
  // תודה לעונים · תודה למי שעוזר · תודה מראש
  new RegExp(EDGE + String.raw`תודה\s+(?:לעונים|לעונות|מראש|למי\s+ש)`, "u"),
  // האם כדאי / שווה
  new RegExp(EDGE + String.raw`האם\s+(?:כדאי|שווה|זה\s+שווה)`, "u"),
  /\b(?:has\s+)?anyone\s+(?:here\s+)?(?:heard|tried|know|studied|taken)\b/i,
  /\bwould\s+(?:love|appreciate)\s+(?:to\s+hear|any\s+(?:advice|recommendations))\b/i,
];

/**
 * A school selling a course, dressed as career content.
 *
 * "סימולציית QA" — a worked interview exercise — reads to the decomposer as a
 * QA posting, because it is entirely about QA. So does a bootcamp's "how to
 * break into QA at 30+". These are adverts for training, and the reader is
 * being sold a course rather than offered a job.
 *
 * Deliberately NOT cues: bare `קורס`, `הכשרה`, `לימודים`, `קריירה`. All four
 * appear in genuine vacancies in the same groups — a real opening for a QA
 * instructor ("דרוש/ה מדריך/ת QA … בקורס פרונטלי"), a real management trainee
 * scheme ("מגייסת למסלול הכשרה ניהולית"), a real sales job selling courses.
 * Each cue below needs the marketing structure around the word, not the word.
 */
const COURSE_AD_CUES: RegExp[] = [
  // סימולציית QA · סימולציות בדיקות — a teaching exercise, not a vacancy
  new RegExp(EDGE + String.raw`סימולצי(?:ה|ות|ית|יות)\s*(?:QA|בדיקות|ראיון|מריאיון)`, "iu"),
  // הרשמה נפתחה · הרשמה לקורס · נפתחה ההרשמה
  new RegExp(EDGE + String.raw`(?:ה)?הרשמה\s+(?:נפתחה|לקורס|ללימודים|למחזור)`, "u"),
  new RegExp(EDGE + String.raw`נפתח(?:ה|ו)?\s+(?:ה)?(?:הרשמה|מחזור|קורס)`, "u"),
  // מחזור חדש · פתיחת מחזור
  new RegExp(EDGE + String.raw`(?:מחזור\s+חדש|פתיחת\s+מחזור)`, "u"),
  // בוגרי הקורס · בוגרות המכללה מושמים
  new RegExp(EDGE + String.raw`בוגר(?:י|ות)\s+(?:ה)?(?:קורס|מכללה|תוכנית)`, "u"),
  // מלגה / מלגות ללימודים
  new RegExp(EDGE + String.raw`מלג(?:ה|ות)(?![֐-׿])`, "u"),
  // תעודת הנדסאי · תואר במכללת
  new RegExp(EDGE + String.raw`תעודת\s+הנדסא(?:י|ית)`, "u"),
  /*
   * The success story. This is the shape of the post that ranked FIRST for a
   * search on "QA" — a school telling Anna's story and closing with an
   * invitation. The giveaway is first-person-plural ownership of the school:
   *
   *   כשהיא הגיעה אלינו למכללה לאוטומציה, הכל השתנה
   *
   * A vacancy never says "when she came to us, at the college".
   */
  new RegExp(EDGE + String.raw`(?:אלינו|אצלנו|אלייך|שלנו)\s+ל?(?:מכללה|קורס|תוכנית\s+ההכשרה)`, "u"),
  new RegExp(EDGE + String.raw`(?:ל)?מכללה\s+ל(?:אוטומציה|בדיקות|סייבר|תכנות|הייטק)`, "u"),
  // "How do you get into…" — a headline, not an opening.
  new RegExp(EDGE + String.raw`איך\s+(?:מגיעים|נכנסים|נכנסות|הופכים|הופכות|לומדים)`, "u"),
  /*
   * חולמים להיכנס לתחום — narrowed to the "breaking in" sense.
   *
   * `הצעד הראשון שלכם` was a cue here and had to go: a sweep over the whole
   * index caught two genuine entry-level vacancies with it, including
   * "9,000 ש\"ח לרכז.ת גיוס לתפקיד התחלתי — בוא.י לעשות את הצעד הראשון שלך
   * לקריירה מצליחה". Recruiters write that line as often as schools do, so it
   * separates nothing. `חולמים על` went with it for the same reason.
   */
  new RegExp(EDGE + String.raw`חולמ(?:ים|ות)\s+להיכנס`, "u"),
  // מנטורינג · ליווי צמוד עד ההשמה — bootcamp vocabulary, not employer vocabulary
  new RegExp(EDGE + String.raw`מנטורינג(?![֐-׿])`, "u"),
  new RegExp(EDGE + String.raw`ליווי\s+צמוד\s+(?:עד|ומנטורינג)`, "u"),
  /\benroll\s+(?:now|today)\b/i,
  /\b(?:bootcamp|course)\s+(?:starts|starting|registration)\b/i,
];

/**
 * Marketing and thought-leadership: a post about the industry, not a job in it.
 *
 * Two were reported together, and they are the same genre wearing different
 * clothes:
 *
 *   אם מחר בבוקר העסק שלכם ייקלע לאירוע סייבר … בוובינר הקרוב, רועי שגב,
 *   מייסד ומנכ"ל … יעשה סדר במה שבעלי עסקים ומנהלים באמת צריכים לדעת
 *
 *   How is AI changing cybersecurity, and what does that mean for the modern
 *   CISO? In Part 2 of this Root to CISO conversation …
 *
 * Both decompose beautifully — the first tags as security, the second as
 * security and AI — because they are *about* the field. Neither offers a job.
 *
 * The two reliable tells: the audience is business owners rather than
 * candidates, and the artefact being promoted is a webinar, a podcast or an
 * article rather than a role.
 */
const CONTENT_POST_CUES: RegExp[] = [
  // The thing being promoted.
  new RegExp(EDGE + String.raw`(?:ו|וו)ובינר`, "u"),
  new RegExp(EDGE + String.raw`פודקאסט`, "u"),
  new RegExp(EDGE + String.raw`(?:בפרק|הפרק)\s+(?:ה)?(?:חדש|הקרוב|\d)`, "u"),
  /\bwebinar\b/i,
  /\bpodcast\b/i,
  /\b(?:in\s+)?part\s+\d+\s+of\s+(?:this|our)\b/i,
  /\bepisode\s+\d+/i,
  // The audience: businesses, not candidates.
  new RegExp(EDGE + String.raw`(?:העסק|הארגון|החברה)\s+שלכם`, "u"),
  new RegExp(EDGE + String.raw`(?:ל)?בעלי\s+עסקים`, "u"),
  /*
   * A headline question about the field. "How is AI changing cybersecurity…"
   * is an article title; a vacancy never opens this way. Restricted to the
   * interrogatives that introduce a topic — a hiring hook asks the reader
   * about themselves ("רוצה לעבוד בהייטק?", "Looking for your next role?"),
   * which none of these match.
   */
  /^\W{0,4}(?:how|what|why|when)\s+(?:is|are|do|does|did|can|will|has|have)\b/i,
  new RegExp("^\\W{0,4}(?:כיצד|מדוע)\\s", "u"),
];

/**
 * First-person-singular density, as a catch-all behind the cue lists.
 *
 * Every cue above is a phrase somebody thought to write down, which makes the
 * gate only ever as good as the last report. This is the structural signal
 * underneath all of them: a person describing themselves says "I" and "my"
 * repeatedly, and an employer describing a vacancy does not.
 *
 *   אני מיכאל, מחפש את ההזדמנות הראשונה שלי … יש לי רקע … יצא לי לעבוד
 *
 * Three distinct markers are required, and any employer voice at all cancels
 * it, because a founder writing "אני מחפש מפתח לצוות שלי" is hiring.
 */
const FIRST_PERSON = [
  new RegExp(EDGE + String.raw`אני(?![֐-׿])`, "gu"),
  new RegExp(EDGE + String.raw`שלי(?![֐-׿])`, "gu"),
  new RegExp(EDGE + String.raw`לי(?![֐-׿])`, "gu"),
  new RegExp(EDGE + String.raw`אותי(?![֐-׿])`, "gu"),
  /\bi\s*(?:'|’)?m\b/gi,
  /\bmy\b/gi,
  /\bmyself\b/gi,
];

const EMPLOYER_VOICE = [
  new RegExp(EDGE + String.raw`אנחנו(?![֐-׿])`, "u"),
  new RegExp(EDGE + String.raw`אנו(?![֐-׿])`, "u"),
  new RegExp(EDGE + String.raw`שלנו(?![֐-׿])`, "u"),
  new RegExp(EDGE + String.raw`אלינו(?![֐-׿])`, "u"),
  /\bwe\b/i,
  /\bour\b/i,
];

const FIRST_PERSON_THRESHOLD = 3;

/**
 * How many first-person markers appear in total.
 *
 * Occurrences, not distinct kinds. Hebrew leans hard on two of them: "יש לי
 * רקע … והידע שלי כולל … אשמח אם תוכלו לעזור לי" is unmistakably somebody
 * describing themselves, and it uses only לי and שלי. Counting kinds scored
 * that a 2 and let it through.
 */
function firstPersonMarkers(head: string): number {
  let n = 0;
  for (const re of FIRST_PERSON) {
    re.lastIndex = 0;
    n += (head.match(re) ?? []).length;
  }
  return n;
}

function hasEmployerVoice(head: string): boolean {
  return EMPLOYER_VOICE.some((re) => re.test(head));
}

/**
 * Unmistakably an opening. Any of these vetoes a seeker match.
 *
 * "דרוש/ה" and "מגייסים" have no first-person reading at all — nobody writes
 * them about themselves.
 *
 * The last few were added with DISCUSSION_CUES and COURSE_AD_CUES, because
 * those two classes reach words that real vacancies also use. A company
 * writing "חברה מובילה מחפשת Junior System Administrator" says "מחפשת"
 * without saying "אנחנו", and a trainee scheme is literally a הכשרה — both
 * need an explicit hiring reading to survive.
 */
const HIRING_CUES: RegExp[] = [
  new RegExp(EDGE + String.raw`דרוש(?:ה|ים|ות|\/ה|\/ות)?(?![֐-׿])`, "u"),
  new RegExp(EDGE + String.raw`דרושה(?![֐-׿])`, "u"),
  new RegExp(EDGE + String.raw`מגייס(?:ים|ות|ת|תי)?(?![֐-׿])`, "u"),
  new RegExp(EDGE + String.raw`הצטרפ(?:ו|י)\s+(?:אלינו|לצוות)`, "u"),
  /*
   * Hiring in the first person singular, which the density rule would
   * otherwise read as self-description. A sweep over every open social row
   * turned up exactly one false positive and it was this shape:
   *
   *   מחפשת מעצב/ת פנים להצטרף אליי לסטודיו … אני מחפשת מישהו/י שייכנס איתי
   *
   * A studio owner hiring a designer — אני, שלי and לי all over it, and not a
   * "we" in sight, because there is only one of her.
   */
  new RegExp(EDGE + String.raw`(?:להצטרף|שיצטרף|שתצטרף|שייכנס|שתיכנס)\s+(?:אליי|אלי|איתי|אלינו)`, "u"),
  new RegExp(EDGE + String.raw`מחפש(?:ת|ים|ות)?\s+(?:מישהו|מישהי|מי)\s+ש`, "u"),
  /\blooking\s+for\s+(?:someone|somebody)\s+(?:to|who)\b/i,
  /\bjoin\s+me\b/i,
  new RegExp(EDGE + String.raw`אנחנו\s+(?:מחפשים|מגייסים|מרחיבים)`, "u"),
  new RegExp(EDGE + String.raw`לצוות\s+(?:שלנו|המתרחב)`, "u"),
  /*
   * A founder hiring in the first person. Needed by the density rule above:
   * "אני מחפש מפתח לצוות שלי" carries אני and שלי and no "we" at all, so
   * without this it would read as somebody advertising themselves.
   */
  new RegExp(EDGE + String.raw`(?:לצוות|לחברה|לסטארטאפ|לעסק|במשרד)\s+שלי(?![֐-׿])`, "u"),
  /\bwe\s*(?:'|’)?\s*(?:re|are)\s+(?:hiring|looking\s+for|growing)/i,
  /\bjoin\s+(?:our|the)\s+team\b/i,
  /\bnow\s+hiring\b/i,
  /\b(?:is|are)\s+hiring\b/i,
  /\bopen\s+position(?:s)?\b/i,
  /\bapply\s+(?:now|here|via)\b/i,
  // חברה … מחפשת/מחפש — third person, an employer describing itself. Distinct
  // from the bare "מחפש עבודה" seeker cue, which has no subject at all.
  new RegExp(
    EDGE +
      String.raw`(?:חברה|חברת|קבוצת|ארגון|סטארטאפ|מפעל)\s+(?:\S+\s+){0,3}?(?:מחפש|מחפשת|מחפשים|מגייס|מגייסת|מגייסים)`,
    "u",
  ),
  // תיאור התפקיד · מה כולל התפקיד · דרישות התפקיד — the furniture of a spec
  new RegExp(EDGE + String.raw`(?:תיאור|דרישות|מה\s+כולל)\s+(?:ה)?תפקיד`, "u"),
  // לפרטים שלחו/פנו · קו"ח ל… — how a vacancy closes
  new RegExp(EDGE + String.raw`לפרטים\s+(?:נוספים\s+)?(?:שלחו|פנו|צרו|ניתן|תשלח|תשאיר)`, "u"),
  new RegExp(EDGE + String.raw`(?:קו"ח|קו״ח|קורות\s+חיים)\s+(?:ל|אל|למייל|ניתן\s+לשלוח)`, "u"),
  // מסלול הכשרה · תוכנית הכשרה — a trainee scheme IS a job
  new RegExp(EDGE + String.raw`(?:מסלול|תוכנית|תכנית)\s+הכשרה`, "u"),
  /*
   * Wanting to hire a freelancer, as opposed to being one. "אני מחפשת
   * פרילנסר/ית עם 1-2 שנות ניסיון בעיצוב מוצר" is a vacancy written in the
   * first person, so the freelance cue matches it and only this can save it.
   */
  new RegExp(
    EDGE + String.raw`(?:מחפש|מחפשת|מחפשים|מחפשות|דרוש|דרושה|מגייס|מגייסת)\S*\s+(?:\S+\s+){0,3}?(?:פרילנסר|פרילנסרית)`,
    "u",
  ),
];

/**
 * Property and goods for sale. A classified ad, posted into a hiring group.
 *
 * Reported on the live site: "להשכרה" — a three-room flat in Kiryat Shalom —
 * sitting in the search results with ₪6.5K+ shown where the salary goes,
 * because the rent parsed as a wage. Others were worse: a flat priced at
 * ₪2,300,000 read as a salary, and a luxury rental at ₪80,000.
 *
 * These came from SEVENTEEN different groups, one each, including
 * israel.hitech.jobs and israel.hightech. So it is not a bad source to drop —
 * it is people posting a flat into a group full of people with salaries. The
 * fix has to be a content gate, the same as the other four classes here.
 *
 * The cues are the transaction words, which is what makes them safe. A vacancy
 * does not open with "להשכרה" or "למכירה", and the two words that could
 * plausibly appear in a real posting — a sales role advertising that the
 * company sells something — are guarded: `למכירה` must not be preceded by a
 * word that makes it a job function ("מנהל מכירות" is a sales manager and does
 * not match, because that is `מכירות` and not `למכירה`).
 */
const CLASSIFIED_AD_CUES: RegExp[] = [
  // להשכרה · להשכיר — for rent. Never the opening of a vacancy.
  new RegExp(EDGE + String.raw`להשכרה(?![֐-׿])`, "u"),
  new RegExp(EDGE + String.raw`להשכיר(?![֐-׿])`, "u"),
  // למכירה — for sale.
  new RegExp(EDGE + String.raw`למכירה(?![֐-׿])`, "u"),
  // Rooms, penthouse, sublet, garden flat, plot — the vocabulary of a listing.
  new RegExp(EDGE + String.raw`\d+\s*חדרים(?![֐-׿])`, "u"),
  new RegExp(EDGE + String.raw`(?:פנטהאוז|סאבלט|דירת\s+(?:גג|גן|קרקע)|יחידת\s+דיור)`, "u"),
  new RegExp(EDGE + String.raw`(?:ממ״ד|ממ"ד|מרפסת\s+שמש|מרפסת\s+סוכה)`, "u"),
  // English equivalents, for the mixed-language groups.
  new RegExp(EDGE + String.raw`for\s+(?:rent|sale)\b`, "iu"),
  new RegExp(EDGE + String.raw`(?:apartment|flat|sublet|roommate)\s+(?:available|for\s+rent)`, "iu"),
];

/** Which kind of non-vacancy this is. Reported so the drops stay auditable. */
export type NonVacancyKind =
  | "seeker"
  | "freelance_ad"
  | "discussion"
  | "course_ad"
  | "content_post"
  | "classified_ad";

export type SeekerVerdict = {
  /**
   * True when the post is not a vacancy.
   *
   * The name is historical — it started out meaning "somebody looking for
   * work" — but it has meant "not an opening" since the freelance adverts were
   * added, and now covers four kinds. `kind` says which.
   */
  isSeeker: boolean;
  /** Which class matched, or null when this reads as a real opening. */
  kind: NonVacancyKind | null;
  /** The cue that decided it, for logging and for tests. */
  matched: string | null;
  /** A hiring cue that vetoed an otherwise-matching post. */
  vetoedBy: string | null;
};

/**
 * Judge a social post.
 *
 * Only the OPENING of the post is examined. A hiring post often closes with
 * "מחפשים עבודה? שלחו קו״ח" and a seeker's post says what it is in its first
 * line; reading the whole body mostly adds noise from comments and signatures.
 */
const CLASSES: [NonVacancyKind, RegExp[]][] = [
  /*
   * Classified ads FIRST, and exempt from the hiring veto below.
   *
   * A flat advertised in a hiring group routinely ends with "לפרטים שלחו הודעה"
   * or a phone number, which HIRING_CUES reads as an employer inviting
   * applications. Every other class here is a judgement about tone that a
   * hiring cue should be allowed to overturn; "להשכרה" is not a judgement, it
   * is the word "for rent", and nothing that follows it makes the post a job.
   */
  ["classified_ad", CLASSIFIED_AD_CUES],
  ["seeker", SEEKER_CUES],
  ["freelance_ad", FREELANCE_AD_CUES],
  ["discussion", DISCUSSION_CUES],
  ["course_ad", COURSE_AD_CUES],
  ["content_post", CONTENT_POST_CUES],
];

export function judgeSeekerPost(text: string, headChars = 400): SeekerVerdict {
  const clear: SeekerVerdict = { isSeeker: false, kind: null, matched: null, vetoedBy: null };

  const head = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, headChars);
  if (!head) return clear;

  let kind: NonVacancyKind | null = null;
  let hit: RegExp | undefined;
  for (const [name, cues] of CLASSES) {
    hit = cues.find((re) => re.test(head));
    if (hit) {
      kind = name;
      break;
    }
  }

  /*
   * No phrase matched, so fall back to the structural signal. This is what
   * stops the gate being only as good as the last bug report: a post carrying
   * three different first-person markers and no employer voice is somebody
   * talking about themselves, whatever words they chose.
   */
  let matched = hit ? String(hit) : null;
  if (!kind) {
    if (hasEmployerVoice(head)) return clear;
    const markers = firstPersonMarkers(head);
    if (markers < FIRST_PERSON_THRESHOLD) return clear;
    kind = "seeker";
    matched = `first-person density (${markers} markers, no employer voice)`;
  }

  // A classified ad is not overturned by a hiring cue: see the note on CLASSES.
  if (kind !== "classified_ad") {
    const veto = HIRING_CUES.find((re) => re.test(head));
    if (veto) return { isSeeker: false, kind: null, matched, vetoedBy: String(veto) };
  }

  return { isSeeker: true, kind, matched, vetoedBy: null };
}

/**
 * Is this post something other than a vacancy?
 *
 * Covers all four classes: somebody looking for work, a freelancer touting for
 * clients, a question asked of the group, and a school selling a course.
 */
export function isNotAVacancyPost(text: string): boolean {
  return judgeSeekerPost(text).isSeeker;
}

/** @deprecated Kept for callers written before the other three classes existed. */
export const isJobSeekerPost = isNotAVacancyPost;
