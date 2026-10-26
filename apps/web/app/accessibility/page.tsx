import type { Metadata } from "next";
import { CONTACT } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Accessibility",
  description:
    "Jobsworm's accessibility statement: what we have done, what is still incomplete, and how to report a barrier.",
};

export default function AccessibilityPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="mb-3">Accessibility statement</h1>
      <p className="m-0 mb-8 text-fg-2">Last reviewed 8 September 2026.</p>

      <p className="text-fg-2">
        Jobsworm is a job search site for the Israeli tech market, and a job search site that
        some people cannot use is not doing its job. We aim to meet{" "}
        <strong>WCAG 2.1 level AA</strong>, which is the standard referenced by Israeli
        Standard 5568 and the Equal Rights for Persons with Disabilities Regulations.
      </p>

      <h2 className="mb-3 mt-10 text-xl">What has been done</h2>
      <ul className="grid gap-1.5 text-fg-2">
        <li>
          Every text and background pair on the site has been checked against a contrast
          calculator rather than estimated. Body text is at least 4.5:1 and most of it is
          considerably higher.
        </li>
        <li>
          The whole interface works from the keyboard, with a visible focus ring on every
          control that follows the shape of the control it is on.
        </li>
        <li>A skip link to the main content is the first thing in the tab order.</li>
        <li>
          Search results announce their count to screen readers when filters change, because
          the list swaps with no visible transition.
        </li>
        <li>
          Every form control has a real label. Placeholders are never used as the only label.
        </li>
        <li>
          Interactive targets are at least 44 by 44 pixels.
        </li>
        <li>
          Headings run in order without skipping levels, and every page has exactly one h1.
        </li>
        <li>
          Animation is minimal and is switched off entirely for anyone whose system requests
          reduced motion.
        </li>
        <li>
          Job listings are frequently written in Hebrew. Each one carries its own text
          direction and alignment, so Hebrew and English listings both read correctly rather
          than one of them being forced the wrong way round.
        </li>
      </ul>

      <h2 className="mb-3 mt-10 text-xl">Known limitations</h2>
      <p className="text-fg-2">
        We would rather list these than claim full conformance we have not verified:
      </p>
      <ul className="grid gap-1.5 text-fg-2">
        <li>
          Job descriptions come from employers and are reproduced as written. If an employer
          published a poorly structured description, we do not rewrite it, so headings and
          lists inside a listing may not always be marked up correctly.
        </li>
        <li>
          The site has not yet been tested end to end with every major screen reader. Testing
          so far has been keyboard, contrast and semantic-structure focused.
        </li>
        <li>There is currently no high-contrast or dark theme.</li>
      </ul>

      <h2 className="mb-3 mt-10 text-xl">Found a barrier?</h2>
      <p className="text-fg-2">
        Tell us and we will fix it. Email{" "}
        <a
          href="mailto:accessibility@jobswarm.com"
          className="text-action-text underline underline-offset-2"
        >
          accessibility@jobswarm.com
        </a>{" "}
        with the page and what went wrong. We reply within a few days, and accessibility
        defects go to the front of the queue rather than into a backlog.
      </p>

      <p className="mt-10 border-t border-line pt-4 text-sm text-fg-2">
        Accessibility coordinator{CONTACT.ownerName ? `: ${CONTACT.ownerName}` : ""} ·{" "}
        <a
          href="mailto:accessibility@jobswarm.com"
          className="text-action-text underline underline-offset-2"
        >
          accessibility@jobswarm.com
        </a>
      </p>
    </div>
  );
}
