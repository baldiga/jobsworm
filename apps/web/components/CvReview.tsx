"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { FUNCTION_LABEL, SENIORITY } from "@/lib/format";

/**
 * What we read from your CV, shown back to you.
 *
 * ## Why this replaced a one-line summary
 *
 * The old panel said "we read 14 skills" and listed eight of them. Everything
 * else the parser decided — your seniority, your years, your field, the
 * headline it chose — went straight into your profile without ever appearing
 * on screen. Those are the fields matching actually keys on, so the reading
 * that most affected results was the reading nobody could see.
 *
 * That is how "the jobs it offered me are team-lead roles" happened. The
 * parser had put a seniority on the profile; the person never saw it, so they
 * had no way to know it was wrong or that it was theirs to fix.
 *
 * ## Saying how sure we are
 *
 * Each field carries a confidence word rather than a number. "We could not
 * tell — please choose" is a genuinely different statement from "fairly sure",
 * and a percentage would imply a precision the heuristics do not have.
 *
 * ## The years figure says where it came from
 *
 * "from the dates on your CV" and "because your CV says so" are different
 * claims, and a reader who disagrees needs to know which one they are arguing
 * with. `yearsBasis` has been computed since the parser was written and has
 * never been shown.
 */

export type CvDraft = {
  skills: string[];
  preferredTitles: string[];
  seniority: string | null;
  seniorityLevels: string[];
  headline: string | null;
  jobFunction: string | null;
  functionConfidence: number | null;
  yearsExperience: number | null;
  yearsBasis: "dates" | "stated" | null;
  currentTitle: string | null;
};

/** A confidence word, not a number. */
function sureness(conf: number | null | undefined): string {
  if (conf == null) return "we could not tell — please choose";
  if (conf >= 0.75) return "fairly sure";
  if (conf >= 0.45) return "worth checking";
  return "we could not tell — please choose";
}

function yearsBasisText(basis: "dates" | "stated" | null): string {
  if (basis === "dates") return "counted from the dates on your CV";
  if (basis === "stated") return "because your CV says so";
  return "we could not work this out";
}

export default function CvReview({
  draft,
  onSeeMatches,
}: {
  draft: CvDraft;
  onSeeMatches?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      /*
       * Only `reviewed` and the years figure are sent. Everything else was
       * already written by the CV route under its edited-vs-leftover rules,
       * and re-sending it from here would overwrite a hand correction the
       * person made between the upload and this click.
       */
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewed: true,
          ...(draft.yearsExperience != null ? { years_experience: draft.yearsExperience } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError("Could not save that. Your CV is still on file.");
        return;
      }
      setConfirmed(true);
      router.refresh();
      onSeeMatches?.();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const nothingFound = draft.skills.length === 0;

  return (
    <div className="mb-4 rounded-card border border-line bg-surface p-4">
      <p className="m-0 flex items-center gap-2 font-semibold">
        <Check aria-hidden="true" className="size-4 shrink-0 text-action-text" />
        Here is what we read. Check it before you look at matches.
      </p>

      <dl className="m-0 mt-3 grid gap-3">
        {draft.currentTitle ? (
          <Row label="Current role">
            <bdi className="jobtext font-medium">{draft.currentTitle}</bdi>
          </Row>
        ) : null}

        <Row
          label="Field"
          note={sureness(draft.functionConfidence)}
        >
          {draft.jobFunction ? (
            <span>{FUNCTION_LABEL[draft.jobFunction] ?? draft.jobFunction}</span>
          ) : (
            <span className="text-warn-text">not identified</span>
          )}
        </Row>

        <Row
          label="Experience"
          note={yearsBasisText(draft.yearsBasis)}
        >
          {draft.yearsExperience != null ? (
            <span className="numeral">
              {draft.yearsExperience} {draft.yearsExperience === 1 ? "year" : "years"}
            </span>
          ) : (
            <span className="text-warn-text">not stated</span>
          )}
        </Row>

        <Row
          label="Level"
          note={
            draft.seniorityLevels.length > 1
              ? "we widened this by one, because Israeli titles disagree about the boundaries"
              : undefined
          }
        >
          {draft.seniorityLevels.length ? (
            <span className="flex flex-wrap gap-1.5">
              {draft.seniorityLevels.map((lv) => (
                <Chip key={lv} tone={lv === draft.seniority ? "accent" : "info"}>
                  {SENIORITY[lv] ?? lv}
                </Chip>
              ))}
            </span>
          ) : (
            <span className="text-warn-text">we could not tell — please choose</span>
          )}
        </Row>

        {draft.preferredTitles.length ? (
          <Row label="Roles we will match you to">
            <span className="flex flex-wrap gap-1.5">
              {draft.preferredTitles.slice(0, 6).map((t) => (
                <Chip key={t}>
                  <bdi>{t}</bdi>
                </Chip>
              ))}
            </span>
          </Row>
        ) : null}

        <Row label={`Skills (${draft.skills.length})`}>
          {draft.skills.length ? (
            <span className="flex flex-wrap gap-1.5">
              {draft.skills.slice(0, 14).map((s) => (
                <Chip key={s} tone="accent">
                  <bdi>{s}</bdi>
                </Chip>
              ))}
              {draft.skills.length > 14 ? (
                <span className="self-center text-xs text-fg-2">
                  and {draft.skills.length - 14} more
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-warn-text">none recognised</span>
          )}
        </Row>
      </dl>

      {nothingFound ? (
        <p className="m-0 mt-3 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text">
          The upload worked — the reading came up empty. Matching looks for known tool and skill
          names, so a CV written mostly in prose can produce nothing to match on. Add a few by
          hand and matching starts working immediately.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 mt-3 text-sm text-warn-text">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={confirm} disabled={busy || confirmed}>
          {confirmed ? "Saved" : busy ? "Saving…" : "Looks right — see my matches"}
        </Button>
        <Link
          href="/me"
          className="inline-flex min-h-9 items-center text-sm underline underline-offset-2"
        >
          Fix anything it got wrong
        </Link>
      </div>

      {/*
        Said here rather than only in the privacy page, because this is the
        moment somebody has just handed over a CV and is wondering.
      */}
      <p className="m-0 mt-3 text-xs text-fg-2">
        Nothing above is shown to employers. We never send your CV anywhere.
      </p>
    </div>
  );
}

function Row({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-sm text-fg-2">{label}</dt>
      <dd className="m-0 text-sm">
        {children}
        {note ? <span className="mt-0.5 block text-xs text-fg-2">{note}</span> : null}
      </dd>
    </div>
  );
}
