import type { Metadata } from "next";
import { DAY_RATE_USD } from "@jobsworm/core";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "For recruiters",
  description:
    `Buy a labelled sponsored listing on Jobsworm. $${DAY_RATE_USD} a day, less by the week. ` +
    "Organic search results are never for sale.",
};

/**
 * The pitch. Public and indexable — this is the page a recruiter finds.
 *
 * ## Why there is almost nothing on it
 *
 * It used to carry "what you get", a pricing table, the rules, and a panel
 * headed "what money does not buy". All of that was true and none of it
 * belonged here: it had become a second copy of the terms, written in
 * friendlier words. Two documents making the same promises is how they start
 * making different ones, and the friendlier copy is always the one that drifts.
 *
 * So the commitments live in /terms, once, and this page does the job a
 * landing page is actually for: say what it is, and offer the two things
 * somebody might want to do next. The second button goes to the terms, so
 * nothing is hidden — it is one click away rather than restated.
 */
export default function RecruitPage() {
  return (
    <PageShell width="narrow">
      <SectionHeading
        level={1}
        kicker="For recruiters"
        title="Put your role in front of people already looking"
        subtitle="A labelled sponsored slot on the home page and on matching searches, for a fixed number of days. Employers and agencies both welcome."
      />

      <div className="mt-8 flex flex-wrap gap-3">
        {/*
          Straight to /recruit/start, not to the login page.

          `/recruit/start` redirects to sign-in itself when there is no
          session, carrying `next` so you come back — so pointing at the login
          page here only made the CTA lie to somebody who was already signed
          in, sending them to log in again before they could do the thing the
          button named. This way the button says what happens either way.
        */}
        <ButtonLink href="/recruit/start" size="lg">
          Set up a recruiter account
        </ButtonLink>
        <ButtonLink href="/terms" variant="ghost" size="lg">
          Read the terms
        </ButtonLink>
      </div>
    </PageShell>
  );
}
