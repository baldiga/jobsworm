import type { Metadata } from "next";
import Link from "next/link";
import { CONSENT_A_TEXT_EN, CONSENT_A_TEXT_HE, CONSENT_A_VERSION } from "@/lib/consent";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Jobsworm collects, why, and how to delete all of it.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="mb-6">Privacy notice</h1>

      <p className="whitespace-pre-line text-fg-2">{CONSENT_A_TEXT_EN}</p>

      <h2 className="mb-3 mt-10 text-xl">What we never collect</h2>
      <ul className="grid gap-1 text-fg-2">
        <li>Age or date of birth</li>
        <li>Gender</li>
        <li>Family status</li>
        <li>Health information</li>
        <li>Religion</li>
        <li>Military unit (only security clearance: yes or no)</li>
        <li>ID number</li>
        <li>Photographs</li>
      </ul>

      <h2 className="mb-3 mt-10 text-xl">Jobs and employers</h2>
      <p className="text-fg-2">
        Listings are collected from employers&apos; own careers pages and applicant tracking
        systems, from public Israeli job boards, and from public Facebook groups. We read
        public groups only, never private ones.
      </p>
      <p className="text-fg-2">
        We do not store the names of the people who posted. From each post we keep the job
        content, a link back to the original, and a coarse marker of what kind of poster it
        was. If the poster&apos;s name cannot be separated from the body of the post with
        certainty, the post is discarded rather than stored.
      </p>
      <p className="text-fg-2">
        Applying always happens on the employer&apos;s own site, never here, and we never
        submit an application on your behalf. An employer, group admin or poster who wants
        content removed can contact us and it will be taken down within 48 hours.
      </p>

      <h2 className="mb-3 mt-10 text-xl">Analytics</h2>
      <p className="text-fg-2">
        We use two analytics tools. <strong>Google Analytics</strong> counts page views; it sets{" "}
        <code>_ga</code> cookies and sends Google the page you are on, a random identifier and a
        rough location from your IP address.
      </p>
      <p className="text-fg-2">
        <strong>PostHog</strong>, hosted in the EU, counts page views and searches and how often
        sponsored listings are shown, opened and clicked. It sets no cookies — it keeps a random
        identifier in your browser&apos;s local storage — records no session replays, and is never
        told who you are. It is not sent the text of what you search for: a search reaches it as a
        one-way hash and a length, never the words.
      </p>
      <p className="text-fg-2">
        Neither tool receives your email, your CV, your skills or anything from your profile.
        Employers and agencies who pay for a labelled sponsored listing see totals only — how many
        times their listing was shown, opened and clicked — and never anything about an individual
        visitor.
      </p>
      <p className="text-fg-2">
        We use all of this to find out which parts of the site are worth building on. Any
        browser-level tracking blocker stops both tools, PostHog also honours your browser&apos;s
        Do Not Track setting, and nothing on the site breaks when you use either.
      </p>

      <h2 className="mb-3 mt-10 text-xl">The number on a job listing</h2>
      <p className="text-fg-2">
        Some listings show how many times they have been opened. That number is counted in our
        own database, not by either analytics tool, and it is the one piece of what visitors do
        here that is shown publicly.
      </p>
      <p className="text-fg-2">
        It counts <strong>visits, not people</strong>. Opening a listing and leaving it open for
        a second counts once; reloading the page does not count again, and coming back tomorrow
        does. We do not store who opened it — no account, no identifier, no address, nothing that
        could be joined back to you afterwards. The row we write says that some visit opened this
        listing, and nothing else.
      </p>
      <p className="text-fg-2">
        The private list of jobs <em>you</em> have viewed, in{" "}
        <Link href="/me" className="text-action-text underline underline-offset-2">
          My area
        </Link>
        , is a separate record and is never part of the public number. A tracking blocker stops
        the public count too, so the real figure is higher than the one shown, never lower.
      </p>

      <h2 className="mb-3 mt-10 text-xl">Your rights</h2>
      <p className="text-fg-2">
        You can view and correct everything we hold about you, and delete your entire account
        in one click, from <strong>My area</strong>. Deletion is immediate and cannot be
        undone. For anything else, write to{" "}
        <a href="mailto:privacy@jobswarm.com" className="text-action-text underline underline-offset-2">
          privacy@jobswarm.com
        </a>
        .
      </p>

      <h2 className="mb-3 mt-10 text-xl" lang="he">
        עברית
      </h2>
      <p dir="rtl" lang="he" className="jobtext whitespace-pre-line text-right text-fg-2">
        {CONSENT_A_TEXT_HE}
      </p>

      <p className="mt-10 border-t border-line pt-4 text-sm text-fg-2">
        Version <span className="numeral">{CONSENT_A_VERSION}</span>
      </p>
    </div>
  );
}
