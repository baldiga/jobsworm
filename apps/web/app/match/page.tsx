import Link from "next/link";
import type { Metadata } from "next";
import { createReadClient, supabaseConfigured } from "@/lib/supabase";
import {
  REMOTE,
  SENIORITY,
  formatSalary,
  locationLabel,
  stalePostingLabel,
  timeAgo,
} from "@/lib/format";
import { explainMatch, type MatchWhy } from "@jobsworm/core";
import { dirOf, textProps } from "@/lib/direction";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import CvAnalyze from "@/components/CvAnalyze";
import CvPrivacyQa from "@/components/CvPrivacyQa";
import CvGaps, { type CvGap } from "@/components/CvGaps";
import CvFreshness from "@/components/CvFreshness";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find by CV",
  description:
    "Upload your CV and see Israeli tech jobs ranked by how much they actually overlap with your skills.",
};

type Match = {
  id: string;
  title_raw: string | null;
  company_name: string | null;
  company_slug: string | null;
  location: unknown;
  seniority: string | null;
  remote: string | null;
  salary: { min?: number | null; max?: number | null; currency?: string | null; raw?: string | null } | null;
  skills_required: string[] | null;
  tech_stack: string[] | null;
  source_provider: string | null;
  posted_at: string | null;
  matched_skills: string[] | null;
  score: number;
  direct_from_employer: boolean | null;
  /** The components of the score, from 0042. Absent before that migration. */
  why: MatchWhy | null;
};

/**
 * How many of the reader's matches the gap counts are drawn from.
 *
 * Shown on the panel ("9 of your top 30"), so it has to be one number used in
 * both the query and the copy — a mismatch there would be a small lie about
 * data the reader is being asked to act on.
 */
const GAPS_OVER = 30;

export default async function MatchPage() {
  /*
   * Public. Seeing what this does, and choosing a file, no longer requires an
   * account — the sign-up gate sits at the moment the file would actually be
   * stored and parsed, which is when we would start holding someone's personal
   * data. See components/CvAnalyze.tsx.
   */
  let signedIn = false;
  let skills: string[] = [];
  let parsedAt: string | null = null;
  let matches: Match[] = [];
  let gaps: CvGap[] = [];
  let daysLeft: number | null = null;
  let failed = false;

  if (supabaseConfigured) {
    const supabase = await createReadClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("skills, cv_parsed_at")
        .eq("user_id", user.id)
        .maybeSingle();
      skills = profile?.skills ?? [];
      parsedAt = profile?.cv_parsed_at ?? null;

      if (skills.length) {
        /*
         * Both queries together. The gaps read from the same matcher over the
         * same top matches, so running them in series would pay for the same
         * work twice and make the slowest page on the site slower again.
         *
         * The gaps panel is decoration: if it errors, the matches still
         * render. It is logged and dropped.
         */
        const [matchRes, gapRes, freshRes] = await Promise.all([
          supabase.rpc("match_jobs_for_me", { p_limit: 40, p_offset: 0 }),
          supabase.rpc("cv_gaps_for_me", { p_top: GAPS_OVER, p_limit: 8 }),
          supabase.rpc("cv_freshness_for_me"),
        ]);
        failed = Boolean(matchRes.error);
        matches = (matchRes.data ?? []) as Match[];
        if (gapRes.error) console.error("[match] cv_gaps_for_me failed:", gapRes.error.message);
        gaps = (gapRes.data ?? []) as CvGap[];
        const fresh = freshRes.data as { days_left?: number | null } | null;
        daysLeft = fresh?.days_left ?? null;
      }
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-3">Find by CV</h1>
      <p className="m-0 mb-8 max-w-[52ch] text-lg text-fg-2">
        Upload your CV once. We pull out the skills, then rank open jobs by how much they
        actually overlap with them — and show you which skills matched, so you can disagree
        with us.
      </p>

      {/*
        Above the uploader, because it is the reason the matches below may be
        empty. Enforcing the 90-day rule silently would leave somebody staring
        at a page that simply stopped working.
      */}
      <CvFreshness daysLeft={daysLeft} />

      <div className="mb-10">
        <CvAnalyze signedIn={signedIn} parsedAt={parsedAt} />
        {/* Answered here, next to the button, not on a page you have to go find. */}
        <CvPrivacyQa />
      </div>

      {signedIn && skills.length ? (
        <>
          <div
            id="your-matches"
            className="mb-5 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 scroll-mt-20"
          >
            <h2 className="text-xl">Your matches</h2>
            <p className="m-0 text-sm text-fg-2">
              Based on <span className="numeral font-semibold">{skills.length}</span> skills.{" "}
              <Link href="/me" className="text-action-text underline underline-offset-2">
                Edit them
              </Link>
            </p>
          </div>

          {failed ? (
            <p className="rounded-control bg-warn-tint px-4 py-3 text-sm text-warn-text">
              Matching is unavailable right now. Try again in a moment.
            </p>
          ) : !matches.length ? (
            <Card>
              <p className="m-0 text-fg-2">
                No open job shares a skill with your profile yet. Try adding a few more skills
                in your area, or broaden them.
              </p>
            </Card>
          ) : (
            <>
              <ol className="m-0 grid list-none gap-3 p-0">
                {matches.map((m) => (
                  <li key={m.id}>
                    <MatchCard match={m} />
                  </li>
                ))}
              </ol>

              {/*
                Below the matches, not above them. The person came to see jobs;
                what their CV is missing is the second question, and putting it
                first would read as a rejection before they have seen anything.
              */}
              <CvGaps gaps={gaps} topN={GAPS_OVER} />
            </>
          )}
        </>
      ) : signedIn && parsedAt ? (
        /*
          Read the CV, recognised nothing in it. SAY SO.

          This branch used to fall through to "Once your CV is analyzed, your
          matches appear here" — which, to somebody who has just uploaded a CV
          and watched it process, means the upload failed. It was reported as
          exactly that: "can't upload and analyse CV". The upload had worked;
          only the page said otherwise.

          Rare but real: 4 of 425 CVs parse to no skills at all. The parser is a
          dictionary of tech and go-to-market terms, so a CV written in plain
          prose, or in a field the dictionary does not cover, comes back empty.
          That is a limitation to admit and route around, not to disguise as a
          pending state.
        */
        <Card>
          <h2 className="mb-2 text-lg">We read your CV, but did not recognise any skills</h2>
          <p className="m-0 text-fg-2">
            The upload worked — the reading is what came up empty. Matching looks for known
            tools and skill names, so a CV written mostly in prose, or in a field the
            dictionary does not cover yet, can come back with nothing to match on.
          </p>
          <p className="m-0 mt-3 text-fg-2">
            Add a few skills by hand in{" "}
            <Link href="/me" className="text-action-text underline underline-offset-2">
              My area
            </Link>{" "}
            and matching starts working immediately. Uploading a different version of your
            CV also re-reads it from scratch.
          </p>
        </Card>
      ) : signedIn ? (
        <Card>
          <p className="m-0 text-fg-2">
            Once your CV is analyzed, your matches appear here.
          </p>
        </Card>
      ) : (
        <section className="rounded-card border border-line bg-surface-2 p-5">
          <h2 className="mb-2 text-lg">What you get</h2>
          <ul className="m-0 grid list-none gap-2 p-0 text-fg-2">
            <li>Jobs ranked by real skill overlap, not by a keyword in the title.</li>
            <li>The matching skills shown on every result, so the ranking is checkable.</li>
            <li>An editable skill list — fix anything the parser got wrong.</li>
          </ul>
          <p className="m-0 mt-4 text-sm font-medium">
            Free forever. You can search the whole index without an account.
          </p>
        </section>
      )}
    </div>
  );
}

function MatchCard({ match }: { match: Match }) {
  const city = locationLabel(match.location);
  const salary = formatSalary(match.salary);
  const matched = match.matched_skills ?? [];
  const posted = timeAgo(match.posted_at);
  const stale = stalePostingLabel(match.posted_at);
  const title = match.title_raw ?? "";
  const titleProps = textProps(title);
  const company = match.company_name ?? "";
  const why = explainMatch(match.why);

  return (
    <Card interactive className="card-hit group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 dir={titleProps.dir} className={`jobtext ${titleProps.className} leading-snug`}>
            <Link
              href={`/jobs/${match.id}`}
              className="card-link outline-offset-4 group-hover:text-action-text"
            >
              {title}
            </Link>
          </h3>
          <p className="m-0 mt-1 text-sm text-fg-2">
            <span className="jobtext font-medium" dir={dirOf(company)}>
              {company}
            </span>
            {city ? ` · ${city}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {/*
            1-110. Above 100 means skills, field, seniority, region and a
            direct-to-employer application all lined up. Shown as a number
            rather than stars because the components are stated and checkable.
          */}
          {/*
            Shown as "95/110", not "95".

            A bare two-digit number in a coloured chip reads as a percentage,
            and was read as one: "אומר לי שיש לי 95% התאמה למשרה כזאת שבמציאות
            זה לא נכון". It is a 1-110 score whose largest single component is
            skill overlap, so a junior with a long skill list can score high
            against a senior role. The denominator is the cheapest way to stop
            it claiming to be a probability of fit.
          */}
          <span
            title={`Match score ${match.score} out of 110. Mostly skill overlap — it is not a percentage fit.`}
            className={`numeral rounded-control px-2.5 py-1 text-[15px] font-bold ${
              match.score >= 100
                ? "bg-action text-on-action"
                : match.score >= 60
                  ? "bg-accent-tint text-accent-text"
                  : "bg-surface-2 text-fg-2"
            }`}
          >
            {match.score}
            <span className="opacity-60">/110</span>
          </span>
          {salary ? (
            <bdi
              dir="ltr"
              className="numeral rounded-chip border border-line px-2 py-1 text-[15px] font-bold text-fg"
            >
              {salary}
            </bdi>
          ) : null}
        </div>
      </div>

      {/* The "why" is the overlap itself, so show it rather than a score. */}
      {matched.length ? (
        <div className="m-0 mt-3 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-fg-2">Matched on</span>
          {matched.slice(0, 6).map((s) => (
            <Chip key={s} tone="accent">
              <bdi>{s}</bdi>
            </Chip>
          ))}
          {matched.length > 6 ? (
            <span className="text-fg-2">and {matched.length - 6} more</span>
          ) : null}
        </div>
      ) : null}

      {/*
        And why NOT.

        The score has always been able to explain itself and never did. A
        reader seeing 87 could not tell "you have every skill but it is two
        levels above you" from "you have three of eight and everything else
        lines up" — opposite decisions, identical number.

        Exactly one negative, chosen by which gap actually decides the outcome.
        Listing every gap turns the page into ten rejection letters and teaches
        people to stop reading it.
      */}
      {why.negative ? (
        <p className="m-0 mt-2 flex items-start gap-1.5 text-[13px] text-warn-text">
          <span aria-hidden="true">·</span>
          <span>{why.negative}</span>
        </p>
      ) : null}

      {/*
        The missing skills, separately and as chips, because this is the one
        negative that is also a to-do list — it is the difference between "you
        are not good enough" and "here is what those jobs want".
      */}
      {why.missing.length ? (
        <div className="m-0 mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-fg-2">They also ask for</span>
          {why.missing.slice(0, 5).map((s) => (
            <Chip key={s} tone="warn">
              <bdi>{s}</bdi>
            </Chip>
          ))}
        </div>
      ) : null}

      <p className="m-0 mt-3 flex flex-wrap gap-2 text-xs text-fg-2">
        {match.seniority ? <span>{SENIORITY[match.seniority] ?? match.seniority}</span> : null}
        {match.remote && match.remote !== "unknown" ? <span>· {REMOTE[match.remote]}</span> : null}
        {posted ? <span>· {posted}</span> : null}
        {match.direct_from_employer ? <span>· apply direct</span> : null}
      </p>

      {/* A high match score on a listing from last spring is still a listing
          from last spring. */}
      {stale ? (
        <p className="m-0 mt-2">
          <Chip tone="warn">{stale}</Chip>
        </p>
      ) : null}
    </Card>
  );
}
