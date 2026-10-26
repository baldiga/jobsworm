import { NextResponse } from "next/server";
import { createActionClient } from "@/lib/supabase";
import { parseCv, seniorityFromYears, type ParsedCv } from "@jobsworm/core";

export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;

const ACCEPTED = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

/** Seniority levels, in the order the enum declares them. */
const LEVELS = ["student", "junior", "mid", "senior", "lead", "manager", "director", "exec"];

/**
 * The levels a CV plausibly fits, from its years of experience.
 *
 * One level either side of the reading, not the single point. The parser
 * infers years from dates and phrasing and is regularly a year out, Israeli
 * titles disagree about where mid ends and senior begins, and the matching
 * score now PENALISES distance — so a point estimate makes a wrong reading
 * expensive. Returns an empty array when the years could not be read at all,
 * which leaves matching to ignore seniority rather than guess it.
 */
function levelsFromYears(years: number | null): string[] {
  const centre = seniorityFromYears(years);
  if (!centre) return [];
  const i = LEVELS.indexOf(centre);
  if (i === -1) return [centre];
  return LEVELS.slice(Math.max(0, i - 1), Math.min(LEVELS.length, i + 2));
}

/** Extract plain text. Both libraries are pure JS, so this stays serverless-safe. */
async function extractText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(buf);
    const { text } = await pdfText(doc, { mergePages: true });
    return typeof text === "string" ? text : String(text ?? "");
  }

  if (file.name.toLowerCase().endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
    return value;
  }

  return new TextDecoder().decode(buf);
}

export async function POST(request: Request) {
  const supabase = await createActionClient();
  /*
   * `error`, not just `user`.
   *
   * This used to read only `data.user` and answer 401 for anything falsy. That
   * conflates two different events: "you are not signed in", and "we could not
   * reach the auth server to ask". The second one happens — the functions run
   * in Virginia and the database is in Tokyo, so every auth check is a
   * transatlantic-plus round trip and a slow one occasionally fails — and when
   * it did, a signed-in person was told their upload had failed. That was
   * reported by a user who was demonstrably signed in: her account chip was on
   * screen at the time, and she had no resume row and no stored file, which is
   * only reachable through this branch.
   *
   * A 4xx from the auth server means the session really is bad. Anything else
   * is ours, and saying so lets the reader do the one useful thing: retry.
   */
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData?.user ?? null;

  if (!user && authError) {
    const status = (authError as { status?: number }).status;
    if (!status || status >= 500) {
      console.error("[cv] auth check failed:", status ?? "no status", authError.message);
      return NextResponse.json(
        {
          ok: false,
          error: "We could not check your sign-in just now. Please try again in a moment.",
        },
        { status: 503 },
      );
    }
  }

  /*
   * `error` as well as `reason`. The client falls back to a generic "That
   * upload failed" when `error` is absent, so the one message this route could
   * not express was the commonest one: sign in again.
   */
  if (!user) {
    return NextResponse.json(
      { ok: false, reason: "auth", error: "Your session has expired. Please sign in again." },
      { status: 401 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "That file is larger than 5MB" }, { status: 413 });
  }
  if (file.type && !ACCEPTED.has(file.type) && !/\.(pdf|docx|txt)$/i.test(file.name)) {
    return NextResponse.json({ ok: false, error: "Unsupported format. Use PDF, DOCX or TXT." }, { status: 415 });
  }

  let text = "";
  try {
    text = await extractText(file);
  } catch {
    return NextResponse.json(
      { ok: false, error: "We could not read that file. Try a different PDF, or upload it as text." },
      { status: 422 },
    );
  }

  if (text.trim().length < 120) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "We could not find enough text in that file. If it is a scan, try a version with real text.",
      },
      { status: 422 },
    );
  }

  /*
   * Guarded, unlike before. `extractText` above has always been wrapped and
   * this was not, so a throw anywhere in the parser became an unhandled 500 —
   * which answers with HTML, which makes `res.json()` throw in the browser,
   * which lands in the client's catch and shows the same generic message. A
   * whole class of failure with no message and no log.
   *
   * Probed against a Hebrew administration CV and 141KB of pathological
   * repetition and it neither threw nor hung, so this is not today's bug. It is
   * the guard that would have told us that in one line instead of an evening.
   */
  let parsed: ParsedCv;
  try {
    parsed = parseCv(text);
  } catch (err) {
    console.error("[cv] parse threw:", err instanceof Error ? err.stack : String(err));
    return NextResponse.json(
      { ok: false, error: "We could not read the structure of that CV. Please try another file." },
      { status: 422 },
    );
  }

  // The file itself goes to a private bucket; only the owner can read it, and
  // only through a short-lived signed URL (PLAN.md section 2).
  const path = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });

  /*
   * WHICH FIELDS MAY A NEW CV REPLACE?
   *
   * This used to keep whatever was already there — `profile?.skills?.length ?
   * profile.skills : parsed.skills`. The intent was to protect a hand
   * correction, but it could not tell a correction from a leftover, so the
   * FIRST CV set your skills permanently and every upload after it changed
   * nothing at all. Since matching runs on `skills`, uploading a different CV
   * and pressing Analyze appeared to do nothing. A user reported exactly that,
   * and she was right.
   *
   * The previous parse is on record, which is what makes the two cases
   * separable: if the stored value still equals what the LAST CV produced,
   * nobody has touched it and a new CV may replace it. If it differs, the user
   * edited it by hand and their version wins.
   *
   * Read before the new resume row is inserted, or "the previous parse" would
   * be this one.
   */
  const [{ data: previous }, { data: profile }] = await Promise.all([
    supabase
      .from("resumes")
      .select("parsed")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("skills, preferred_titles, seniority, seniority_levels, headline, job_function")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const prior = (previous?.parsed ?? null) as Partial<ParsedCv> | null;

  const sameList = (a?: string[] | null, b?: string[] | null) =>
    JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

  /** The stored value is the user's own work, not the last parse's output. */
  const listEdited = (stored?: string[] | null, fromPrior?: string[] | null) =>
    Boolean(stored?.length) && Boolean(prior) && !sameList(stored, fromPrior);
  const valueEdited = <T,>(stored: T | null | undefined, fromPrior: T | null | undefined) =>
    stored != null && Boolean(prior) && stored !== fromPrior;

  const priorLevels = levelsFromYears(prior?.yearsExperience ?? null);

  const titlesFrom = (p: Partial<ParsedCv> | null) => [
    ...new Set([p?.currentTitle, ...(p?.titles ?? [])].filter(Boolean) as string[]),
  ];

  /*
   * The resume row, and this time the error is read.
   *
   * `storage_path` was `not null` until 0041 while this line wrote NULL on any
   * upload failure — so the insert failed, and nothing checked. That loses
   * more than the file: `resumes.parsed` is where "the previous parse" comes
   * from, and the comparison above is what decides whether a profile field was
   * hand-edited or merely left over. With no row written, the NEXT upload
   * compares against a stale parse, concludes the user edited fields they
   * never touched, and refuses to update them from then on.
   *
   * One storage hiccup and a person's CV analysis silently stops working. So
   * the insert now fails loudly, and the file metadata that the schema has had
   * columns for since 0004 is finally written.
   */
  const { data: resume, error: resumeError } = await supabase
    .from("resumes")
    .insert({
      user_id: user.id,
      storage_path: uploadError ? null : path,
      filename: file.name.slice(0, 300),
      mime_type: file.type || null,
      size_bytes: file.size,
      text: text.slice(0, 100_000),
      parsed,
    })
    .select("id")
    .single();

  if (resumeError) {
    console.error("[cv] resume insert failed:", resumeError.message);
    return NextResponse.json(
      { ok: false, error: "We read your CV but could not save it. Please try again." },
      { status: 500 },
    );
  }

  await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      skills: listEdited(profile?.skills, prior?.skills) ? profile!.skills : parsed.skills,
      // The current role leads, because it is the best single statement of what
      // someone is looking for next; the rest follow as context.
      preferred_titles: listEdited(profile?.preferred_titles, titlesFrom(prior))
        ? profile!.preferred_titles
        : titlesFrom(parsed),
      seniority: valueEdited(
        profile?.seniority,
        seniorityFromYears(prior?.yearsExperience ?? null),
      )
        ? profile!.seniority
        : seniorityFromYears(parsed.yearsExperience),
      /*
       * Seed the multi-select from the CV as well.
       *
       * Reported: "אני ג'וניור בתעשייה ללא ניסיון … חשבתי שהוא יודע על פי
       * הקו"ח את הרמה שלי" — I assumed it knew my level from my CV. It does
       * work that out, into the singular `seniority` column, but the array is
       * what the profile screen renders and what matching prefers, so the
       * reading never showed up as a choice anybody could see or correct.
       *
       * The neighbouring level comes along with it: somebody the parser reads
       * as junior is a plausible fit for mid postings too, and Israeli titles
       * disagree about the boundary. Widening by one here is what stops the
       * seniority distance penalty being harsher than the reading deserves.
       */
      seniority_levels: listEdited(profile?.seniority_levels, priorLevels)
        ? profile!.seniority_levels
        : levelsFromYears(parsed.yearsExperience),
      headline: valueEdited(profile?.headline, prior?.headline ?? null)
        ? profile!.headline
        : parsed.headline,
      years_experience: parsed.yearsExperience,
      // Classified from the CV, and the reason a marketing CV no longer ranks
      // backend jobs.
      job_function: valueEdited(profile?.job_function, prior?.jobFunction ?? null)
        ? profile!.job_function
        : parsed.jobFunction,
      function_confidence: parsed.functionConfidence,
      cv_parsed_at: new Date().toISOString(),
      cv_fresh_until: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    },
    { onConflict: "user_id" },
  );

  /*
   * `draft` is what the UI should render: the profile as it now stands, after
   * the edited-vs-leftover rules above decided what to keep.
   *
   * `parsed` is the raw reading and is returned alongside it, but it must not
   * be what the screen shows — CvAnalyze was reading `parsed.seniority`, a
   * field `ParsedCv` has never had, so the seniority line was permanently
   * blank. Seniority is DERIVED from years here, in this route, and was never
   * in the parser's output at all.
   */
  const draft = {
    skills: parsed.skills,
    preferredTitles: titlesFrom(parsed),
    seniority: seniorityFromYears(parsed.yearsExperience),
    seniorityLevels: levelsFromYears(parsed.yearsExperience),
    headline: parsed.headline,
    jobFunction: parsed.jobFunction,
    functionConfidence: parsed.functionConfidence,
    yearsExperience: parsed.yearsExperience,
    yearsBasis: parsed.yearsBasis,
    currentTitle: parsed.currentTitle,
  };

  return NextResponse.json({
    ok: true,
    parsed,
    draft,
    resumeId: resume?.id ?? null,
    storedFile: !uploadError,
  });
}
