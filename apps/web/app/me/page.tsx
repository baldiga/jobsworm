import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createReadClient, supabaseConfigured } from "@/lib/supabase";
import {
  REMOTE,
  SENIORITY,
  formatSalary,
  locationLabel,
  stalePostingLabel,
  timeAgo,
} from "@/lib/format";
import { dirOf, textProps } from "@/lib/direction";
import DeleteAccount from "@/components/DeleteAccount";
import ProfileEditor from "@/components/ProfileEditor";
import AppliedToggle from "@/components/AppliedToggle";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ButtonLink, Button } from "@/components/ui/Button";
import { getRecruiter } from "@/lib/recruit";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My area",
  robots: { index: false, follow: false },
};

type SavedRow = {
  id: string;
  title_raw: string | null;
  location: unknown;
  seniority: string | null;
  remote: string | null;
  hybrid_days_office: number | null;
  salary: { min?: number | null; max?: number | null; currency?: string | null; raw?: string | null } | null;
  status: string | null;
  company_name: string | null;
  company_slug: string | null;
  // Returned by my_saved_jobs all along; the type simply never declared them.
  posted_at: string | null;
  first_seen_at: string | null;
  saved_at: string;
};

type ActivityRow = {
  id: string;
  title_raw: string | null;
  company_name: string | null;
  company_slug: string | null;
  location: unknown;
  seniority: string | null;
  remote: string | null;
  salary: SavedRow["salary"];
  status: string | null;
  source_provider: string | null;
  viewed_at: string;
  applied_at: string | null;
  heard_back: boolean | null;
};

export default async function MePage() {
  if (!supabaseConfigured) redirect("/");

  const supabase = await createReadClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=%2Fme");

  const [{ data: savedData }, { data: profile }, { data: activityData }, recruiter] =
    await Promise.all([
      supabase.rpc("my_saved_jobs"),
      supabase
        .from("profiles")
        // One literal, deliberately: supabase-js infers the row type by parsing
        // this string, so concatenating it yields GenericStringError.
        .select(
          "headline, skills, preferred_titles, regions, seniority, seniority_levels, job_functions, remote_prefs, years_experience, cv_parsed_at, job_function",
        )
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.rpc("my_job_activity", { p_only_applied: false }),
      // Alongside the rest rather than after them: it decides one section and
      // should not add a round trip of its own to a page that already makes
      // three.
      getRecruiter(),
    ]);

  const saved = (savedData as SavedRow[] | null) ?? [];
  const activity = (activityData as ActivityRow[] | null) ?? [];
  const applied = activity.filter((a) => a.applied_at);
  const viewed = activity.filter((a) => !a.applied_at);
  const skillCount = profile?.skills?.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-10">
        <h1 className="mb-2">My area</h1>
        <p className="m-0 text-sm text-fg-2">{user.email}</p>
      </header>

      {/*
        Shown only to people who actually have a recruiter account.

        Not an allowlist any more — anybody may create one — but this page
        belongs to the job-seeker product, and a seeker who has never posted a
        job does not need a dashboard link cluttering it. The way IN for them
        is the "Recruiters" tab in the main nav; this is the way BACK for
        somebody who already went through it.

        It lives here rather than in the footer for a reason that cost a build
        to learn: the footer is in the root layout, so reading the session
        there turns every page dynamic — the home page loses its five-minute
        ISR cache and every visitor pays a Supabase round trip to render a link
        most of them cannot use. This page is already signed-in-only and
        already force-dynamic, so the check is free.
      */}
      {recruiter ? (
        <section className="mb-10 rounded-card border border-line bg-surface p-5">
          <h2 className="mb-2 text-lg">For recruiters</h2>
          <p className="m-0 mb-4 text-sm text-fg-2">
            Post a role, buy labelled placement, and see how your listings are doing.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href="/recruit/dashboard">Recruiter dashboard</ButtonLink>
            <ButtonLink href="/recruit/new" variant="ghost">
              Post a job
            </ButtonLink>
          </div>
        </section>
      ) : null}

      {/*
        The job-seeker half of this page, hidden from recruiters.

        CV analysis, skills and matching preferences are for somebody looking
        for work. On a recruiter's account they are not merely unused — they
        invite the reading that we are matching THEM to jobs, on a page they
        reached to manage listings. A recruiter who is also job-hunting can
        still reach /match directly; what is removed is the prompt, not the
        feature.

        The sections below this — applied, viewed, saved — are the same kind of
        thing and go with it.
      */}
      {!recruiter ? (
        <>
          <Section
            title="CV and matching"
            subtitle={skillCount ? `${skillCount} skills on your profile` : "Not analyzed yet"}
          >
            <Card>
              <p className="m-0 text-fg-2">
                {skillCount
                  ? "Your matches are ranked by how much each job overlaps with these skills."
                  : "Upload a CV and we will pull out your skills, then rank jobs by real overlap."}
              </p>
              <div className="mt-4">
                <ButtonLink href="/match">
                  {skillCount ? "View my matches" : "Upload a CV"}
                </ButtonLink>
              </div>
            </Card>
          </Section>

          <Section title="My profile" subtitle="This feeds the matching. Everything is editable.">
            <ProfileEditor profile={profile ?? null} />
          </Section>
        </>
      ) : null}

      {/* Job-seeker history. A recruiter has none of it, and three empty
          panels are not a neutral thing to show them. */}
      {!recruiter ? (
        <>
        <Section
          title="Applied"
          subtitle={
            applied.length
              ? `${applied.length} ${applied.length === 1 ? "job" : "jobs"}`
              : "Mark a job as applied and it shows up here"
          }
        >
          {applied.length ? (
            <ol className="m-0 grid list-none gap-2 p-0">
              {applied.map((job) => (
                <li key={job.id}>
                  <ActivityCard job={job} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="m-0 text-sm text-fg-2">
              After you apply, mark it on the job page to keep track of it.
            </p>
          )}
        </Section>

        <Section
          title="Jobs you viewed"
          subtitle={viewed.length ? `${viewed.length} ${viewed.length === 1 ? "job" : "jobs"}` : undefined}
        >
          {viewed.length ? (
            <ol className="m-0 grid list-none gap-2 p-0">
              {viewed.slice(0, 40).map((job) => (
                <li key={job.id}>
                  <ActivityCard job={job} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="m-0 text-sm text-fg-2">Every job you open shows up here.</p>
          )}
        </Section>

        <Section
          title="Saved jobs"
          subtitle={saved.length ? `${saved.length} ${saved.length === 1 ? "job" : "jobs"}` : undefined}
        >
          {saved.length ? (
            <ol className="m-0 grid list-none gap-2 p-0">
              {saved.map((job) => (
                <li key={job.id}>
                  <SavedCard job={job} />
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="No saved jobs yet"
              action={<ButtonLink href="/jobs">Search jobs</ButtonLink>}
            >
              <p className="m-0">Anything you save shows up here, and we flag it if it closes.</p>
            </EmptyState>
          )}
        </Section>
        </>
      ) : null}

      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="mb-2 text-lg">Your data</h2>
        <p className="mb-4 text-sm text-fg-2">
          We store your email, your profile, your CV and your viewing history. We do not store
          your age, gender, marital status or ID number. Deleting your account erases all of it
          and cannot be undone.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
          <DeleteAccount />
        </div>
        <p className="m-0 mt-4 text-xs text-fg-2">
          See the{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            privacy notice
          </Link>{" "}
          for what we keep and why.
        </p>
      </section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-xl">{title}</h2>
      {subtitle ? <p className="m-0 mb-4 text-sm text-fg-2">{subtitle}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}

function ActivityCard({ job }: { job: ActivityRow }) {
  const city = locationLabel(job.location);
  const closed = job.status !== "open";
  const when = timeAgo(job.applied_at ?? job.viewed_at);
  const title = job.title_raw ?? "";
  const titleProps = textProps(title);
  const company = job.company_name ?? "";

  return (
    <Card muted={closed} className="flex items-start justify-between gap-3 p-3.5">
      <div className="min-w-0">
        <h3 dir={titleProps.dir} className={`jobtext ${titleProps.className} text-[15px] leading-snug`}>
          {closed ? title : <Link href={`/jobs/${job.id}`} className="hover:text-action-text">{title}</Link>}
        </h3>
        <p className="m-0 mt-0.5 text-[13px] text-fg-2">
          <span className="jobtext" dir={dirOf(company)}>
            {company}
          </span>
          {city ? ` · ${city}` : ""}
          {when ? ` · ${job.applied_at ? "Applied" : "Viewed"} ${when.toLowerCase()}` : ""}
        </p>
      </div>
      <div className="shrink-0">
        {closed ? (
          <Chip>Closed</Chip>
        ) : (
          <AppliedToggle jobId={job.id} applied={Boolean(job.applied_at)} compact />
        )}
      </div>
    </Card>
  );
}

function SavedCard({ job }: { job: SavedRow }) {
  const city = locationLabel(job.location);
  const salary = formatSalary(job.salary);
  const closed = job.status !== "open";
  const stale = stalePostingLabel(job.posted_at, job.first_seen_at);
  const title = job.title_raw ?? "";
  const titleProps = textProps(title);
  const company = job.company_name ?? "";

  return (
    <Card muted={closed}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 dir={titleProps.dir} className={`jobtext ${titleProps.className} leading-snug`}>
            {closed ? title : <Link href={`/jobs/${job.id}`} className="hover:text-action-text">{title}</Link>}
          </h3>
          <p className="m-0 mt-1 text-sm text-fg-2">
            <span className="jobtext" dir={dirOf(company)}>
              {company}
            </span>
            {city ? ` · ${city}` : ""}
          </p>
        </div>
        {closed ? (
          <Chip className="shrink-0">Closed</Chip>
        ) : salary ? (
          <bdi
            dir="ltr"
            className="numeral shrink-0 rounded-chip border border-line px-2 py-1 text-[15px] font-bold text-fg"
          >
            {salary}
          </bdi>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-fg-2">
        {job.seniority ? <span>{SENIORITY[job.seniority] ?? job.seniority}</span> : null}
        {job.remote && job.remote !== "unknown" ? <span>· {REMOTE[job.remote]}</span> : null}
        {/* Only worth saying while the job is still open — on a closed one
            the Closed chip already answers the question. */}
        {!closed && stale ? <Chip tone="warn">{stale}</Chip> : null}
      </div>
    </Card>
  );
}
