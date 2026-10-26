import type { Metadata } from "next";
import Link from "next/link";
import { PACKAGES, priceUsd, pricePerDayUsd, DAY_RATE_USD } from "@jobsworm/core";
import { formatUsd } from "@/lib/format";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using Jobsworm. Short, because the service is simple and free.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="mb-3">Terms of use</h1>
      <p className="m-0 mb-8 text-fg-2">
        Last updated 8 September 2026. These terms are short because the service is simple:
        it is a free search engine over publicly posted job ads.
      </p>

      <h2 className="mb-3 mt-8 text-xl">What Jobsworm is</h2>
      <p className="text-fg-2">
        Jobsworm indexes Israeli tech job listings that employers and recruiters have already
        published — on their own careers pages and applicant tracking systems, on public job
        boards, and in public Facebook groups — and makes them searchable in one place. Every
        listing links back to its original source, and applying always happens there.
      </p>

      <h2 className="mb-3 mt-8 text-xl">
        Free for job seekers. Labelled placement for employers and agencies.
      </h2>
      <p className="text-fg-2">
        The service is free for job seekers and intended to stay that way. Employers and
        recruiting agencies may pay for a labelled sponsored slot: a fixed number of days in a
        section marked <em>Sponsored</em>, separate from search results. Payment never changes
        search order. Agency listings appear only in sponsored slots and never in the organic
        index. Every sponsored listing is labelled as one.
      </p>
      <p className="text-fg-2">
        Employers may also post a listing at no charge. A free listing runs for seven days and
        then closes itself; it appears in search exactly like any other listing and is checked
        automatically, not by a person, before it goes up.
      </p>
      <p className="text-fg-2">
        We never give employers or agencies your data — including the ones who pay us.
      </p>

      <h2 className="mb-3 mt-8 text-xl">What we do not do</h2>
      <ul className="grid gap-1 text-fg-2">
        <li>We do not submit applications for you.</li>
        <li>We do not send your CV to employers or to anyone else.</li>
        <li>We do not sell your data.</li>
        <li>
          We do not share your CV, email or activity with employers or agencies, including those
          who pay us. The one exception is a count with nobody in it: a listing may show how many
          times it has been opened, which is a number of visits and carries nothing about who
          made them.
        </li>
        <li>
          We are not a recruitment or placement agency and take no placement fee. A sponsored
          listing is advertising: a labelled slot for a fixed number of days, never a fee per
          hire or per applicant.
        </li>
      </ul>

      {/*
        What a sponsored listing is and costs.

        Moved here from the recruiter pitch page, which had grown into a second
        copy of the terms — the same promises in friendlier words, which is how
        two documents start disagreeing. The pitch is now a heading and two
        buttons; anything that is a commitment lives here, once.

        The prices are computed from `@jobsworm/core`, not typed. A terms page
        that disagrees with the checkout is worse than one that says nothing.
      */}
      <h2 className="mb-3 mt-8 text-xl">What a sponsored listing gets you</h2>
      <ul className="grid gap-1 text-fg-2">
        <li>
          A card in the <em>Sponsored</em> strip on the home page, and above the results of
          searches the role actually matches.
        </li>
        <li>Your own apply link or email address. Applications reach you, not us.</li>
        <li>
          Figures you can check: how many times the card was shown, opened and clicked, broken
          down by day and by surface. The number of opens is also shown publicly on the listing
          itself; the breakdown, the impression counts and the click-through are yours.
        </li>
        <li>No commission, no fee per applicant, no subscription. You buy days.</li>
      </ul>

      <h2 className="mb-3 mt-8 text-xl">Price</h2>
      <p className="text-fg-2">
        ${DAY_RATE_USD} a day; each extra week costs 10% less than the one before. All prices
        include VAT.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-sm text-fg-2">
              <th scope="col" className="py-2 pr-4 font-medium">Length</th>
              <th scope="col" className="py-2 pr-4 font-medium">Total</th>
              <th scope="col" className="py-2 font-medium">Per day</th>
            </tr>
          </thead>
          <tbody>
            {PACKAGES.map((days) => (
              <tr key={days} className="border-b border-line last:border-0">
                <th scope="row" className="py-2.5 pr-4 font-medium">
                  {days} days
                </th>
                <td className="numeral py-2.5 pr-4 font-bold">{formatUsd(priceUsd(days))}</td>
                <td className="numeral py-2.5 text-fg-2">${pricePerDayUsd(days).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-sm text-fg-2">
        Need a different number of days? Ask, and we will invoice for it at the same rates.
      </p>

      <h2 className="mb-3 mt-8 text-xl">Sponsored listings</h2>
      <ul className="grid gap-1 text-fg-2">
        <li>
          Every listing is checked automatically before it goes live, and may be refused at
          that point or removed afterwards.
        </li>
        <li>
          <strong className="font-semibold text-fg">We do not refund.</strong> If you take a
          listing down yourself — because the role is filled, or you changed your mind — the
          days you have not used are not refunded. Take that as final before you pay, not as
          an opening position.
        </li>
        <li>
          The one exception is us. If <em>we</em> refuse a listing before it goes live, you are
          refunded in full; if we remove a live one, we refund the days it did not get. You
          should not be out of pocket for a decision you did not make.
        </li>
        <li>We promise a labelled slot for a number of days — not views, clicks or applications.</li>
        <li>
          Placement is a fixed price per day for everyone. There is no auction and no way to
          outbid anybody, for a sponsored slot or for a position in search.
        </li>
        <li>
          Sponsored placement never affects the order of organic search results — not a nudge,
          not a tiebreak, not a boost. The code that ranks organic results cannot see who paid.
        </li>
        <li>
          Agencies are welcome, labelled as agencies, in sponsored slots only. Agency listings
          never enter the organic index.
        </li>
        <li>
          Real, open tech roles in Israel. Not courses, not agency &ldquo;talent pools&rdquo;,
          not lead generation.
        </li>
        <li>
          An impression is counted once per visit, and only when the card was on screen for a
          full second. Visitors using a tracking blocker are not counted, so the real figures
          are higher than the ones shown, never lower.
        </li>
        <li>Buying placement gives no access to job seekers&rsquo; data of any kind.</li>
      </ul>

      <h2 className="mb-3 mt-8 text-xl">Posting a listing</h2>
      <ul className="grid gap-1 text-fg-2">
        <li>
          It must be a real, currently open role in Israel, and you must be authorised to post
          it.
        </li>
        <li>
          It must state a monthly base salary range. Listings without one are not accepted.
        </li>
        <li>
          Free listings are for employers hiring for themselves, and must send applications to
          your own domain.
        </li>
        <li>
          You can edit a listing at any time while it runs. Editing a live listing keeps it
          live.
        </li>
        <li>
          You can take a listing down yourself at any time, including one you have paid for —
          if the role is filled, it should come down, and we would rather you did. Doing so is
          not refunded, for the days served or the days remaining.
        </li>
      </ul>

      <h2 className="mb-3 mt-8 text-xl">Accuracy, and the limits of it</h2>
      <p className="text-fg-2">
        Listings are written by employers, not by us. We re-check each one against its source
        and remove it when it disappears, but a job can be filled before its ad comes down,
        and details such as salary or location are only as accurate as what was published.
        Treat the original listing as authoritative and verify before you rely on it.
      </p>
      <p className="text-fg-2">
        The service is provided as-is, without warranty. We are not liable for hiring
        decisions, for listings that turn out to be inaccurate or expired, or for anything
        that happens on a third-party site you reach from here.
      </p>

      <h2 className="mb-3 mt-8 text-xl">Your account</h2>
      <p className="text-fg-2">
        An account is optional and needed only for CV matching, saved jobs and application
        tracking. Sign-in is by email and a one-time code; there is no password. You are
        responsible for the security of the email address you use. You can delete your
        account, and everything attached to it, at any time from{" "}
        <Link href="/me" className="text-action-text underline underline-offset-2">
          My area
        </Link>
        .
      </p>

      <h2 className="mb-3 mt-8 text-xl">Acceptable use</h2>
      <p className="text-fg-2">
        Use the site as a person looking for work. Do not scrape it in bulk, resell the index,
        or use it to build a competing dataset. Do not attempt to break the service or access
        other people&apos;s data.
      </p>

      <h2 className="mb-3 mt-8 text-xl">Content removal</h2>
      <p className="text-fg-2">
        If you are an employer, a group admin, or the person who wrote a post and you want a
        listing removed, email{" "}
        <a href="mailto:privacy@jobswarm.com" className="text-action-text underline underline-offset-2">
          privacy@jobswarm.com
        </a>{" "}
        with a link to it. We remove it within 48 hours and do not ask why.
      </p>

      <h2 className="mb-3 mt-8 text-xl">Changes and governing law</h2>
      <p className="text-fg-2">
        We may update these terms; the date at the top shows when they last changed. Israeli
        law applies, and the courts of Tel Aviv have jurisdiction.
      </p>

      <p className="mt-10 border-t border-line pt-4 text-sm text-fg-2">
        Questions:{" "}
        <a href="mailto:privacy@jobswarm.com" className="text-action-text underline underline-offset-2">
          privacy@jobswarm.com
        </a>
        . See also our{" "}
        <Link href="/privacy" className="text-action-text underline underline-offset-2">
          privacy notice
        </Link>{" "}
        and{" "}
        <Link href="/accessibility" className="text-action-text underline underline-offset-2">
          accessibility statement
        </Link>
        .
      </p>
    </div>
  );
}
