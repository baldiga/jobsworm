import Link from "next/link";

/**
 * The five questions someone actually has before handing over their CV.
 *
 * Placed under the upload box rather than on the privacy page, because this is
 * the moment the question gets asked. A policy you have to go and find is not
 * an answer to "wait, what happens to this?".
 *
 * Every answer here is checked against what the code does, not against what
 * would be reassuring to say:
 *
 *   private bucket        app/api/cv/route.ts uploads to the `resumes` bucket,
 *                         which is private; reads need a short-lived signed URL
 *                         for the owner.
 *   extracted fields      packages/core/src/cv.ts returns skills, titles, years,
 *                         headline and function. The route writes those to the
 *                         profile, and the extracted TEXT to `resumes`.
 *   no model              PLAN.md 13 keeps this a heuristic parser rather than
 *                         an LLM call. There is no third party in the path.
 *   90 days / 12 months   `cv_fresh_until` is set to now + 90 days; the consent
 *                         text states the 12-month inactive-account deletion.
 *   never collected       the list is CONSENT_A_TEXT_EN's, verbatim in meaning.
 *
 * If any of those change, this has to change with them. An out-of-date privacy
 * answer is worse than none, because people act on it.
 *
 * Native <details>, so it works with no JavaScript, is keyboard-operable and
 * screen-reader-announced for free, and costs nothing to hydrate.
 */

const QA: { q: string; a: React.ReactNode }[] = [
  {
    q: "Who can see my CV?",
    a: (
      <>
        Only you. The file goes into a private storage bucket that needs a
        short-lived signed link to open, and that link is only ever issued to the account
        that uploaded it. It is never shown to employers, never sent to a recruiter, and
        never sold. Applying always happens on the employer&apos;s own site, and we never
        submit anything on your behalf.
      </>
    ),
  },
  {
    q: "What do you take out of it?",
    a: (
      <>
        Skills, the job titles you have held, roughly how many years you have worked, the
        first line as a headline, and one guess at the kind of role you are in. Those go on
        your profile so jobs can be ranked against them, and you can edit or delete any of
        them in{" "}
        <Link href="/me" className="text-action-text underline underline-offset-2">
          My area
        </Link>
        . The text of the CV is kept too, so that improving the matching later does not mean
        asking you to upload it again.
      </>
    ),
  },
  {
    q: "What exactly do you take out of it?",
    a: (
      <>
        Skills, job titles, how many years you have worked, your field, and a headline. We show
        you every one of those on screen before you look at matches, so you can correct
        anything we got wrong — the parser is rules, not magic, and it does get things wrong.
        Your name is spotted only so that it can be SKIPPED when choosing a headline; it is
        never stored as a field. We do not extract, and never ask for, your age, gender, family
        status, health, religion, army unit, ID number or photo.
      </>
    ),
  },
  {
    q: "Is my CV read by an AI?",
    a: (
      <>
        No. The reading is done by rules on our own server — a dictionary of skills and job
        titles, and some date arithmetic. Your CV is not sent to OpenAI, Anthropic, Google or
        anyone else, and it is not used to train anything. That is also why it sometimes gets
        a career change or a Hebrew CV wrong, which is what the Beta label above is about.
      </>
    ),
  },
  {
    q: "How long do you keep it?",
    a: (
      <>
        A CV stops being used for matching after 90 days — and since 0044 that is enforced, not
        just promised: matching returns nothing once the window has passed, unless you have
        edited your profile since or pressed the button we show you a fortnight beforehand. The
        file is not deleted at that point; it simply stops being used. An account with no
        activity for 12 months is deleted outright. And you can delete your whole account, the
        stored file included, in one click from{" "}
        <Link href="/me" className="text-action-text underline underline-offset-2">
          My area
        </Link>{" "}
        — that happens immediately and cannot be undone.
      </>
    ),
  },
  {
    q: "What will you never take from it?",
    a: (
      <>
        Age or date of birth, gender, family status, health information, religion, your
        military unit, your ID number, and photographs. Those are not collected even when the
        CV contains them. The one security-related thing kept is whether you hold a clearance,
        as a plain yes or no.
      </>
    ),
  },
];

export default function CvPrivacyQa() {
  return (
    <section aria-labelledby="cv-privacy-heading" className="mt-6">
      <h2 id="cv-privacy-heading" className="mb-1 text-lg">
        What happens to your CV
      </h2>
      <p className="m-0 mb-3 text-sm text-fg-2">
        The short version of the{" "}
        <Link href="/privacy" className="text-action-text underline underline-offset-2">
          privacy notice
        </Link>
        , at the point where it matters.
      </p>

      <div className="overflow-hidden rounded-card border border-line bg-surface">
        {QA.map((item, i) => (
          <details key={item.q} className={`group ${i > 0 ? "border-t border-line" : ""}`}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-medium transition-colors hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
              {item.q}
              {/*
                A chevron drawn in CSS rather than an icon import, and marked
                aria-hidden: <details> already announces its own open state, so a
                second announcement would just be noise.
              */}
              <span
                aria-hidden="true"
                className="shrink-0 text-fg-2 transition-transform group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <p className="m-0 px-4 pb-4 text-[15px] leading-relaxed text-fg-2">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
