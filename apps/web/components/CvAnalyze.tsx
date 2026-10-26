"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { Upload, FileText, Sparkles } from "lucide-react";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import CvAnalyzing from "./CvAnalyzing";
import CvReview, { type CvDraft } from "./CvReview";

/**
 * Everything the route decided, not just the skills.
 *
 * The old shape carried four fields and the panel rendered one of them. The
 * three it dropped — seniority, years, field — are the ones matching keys on,
 * so the reading that most affected results was the reading nobody saw.
 */
type ParsedSummary = CvDraft;

/** Where the matches are rendered, so the page can be scrolled to them. */
export const MATCHES_ANCHOR = "your-matches";

/**
 * Scroll to the results once the server has re-rendered them.
 *
 * `router.refresh()` is asynchronous and the matches list does not exist in
 * the DOM at the moment the upload resolves, so a single scrollIntoView call
 * finds nothing and silently does nothing. This retries for a couple of
 * seconds and then gives up rather than scrolling somewhere arbitrary.
 */
function scrollToMatchesWhenReady(): () => void {
  let tries = 0;
  const timer = window.setInterval(() => {
    const target = document.getElementById(MATCHES_ANCHOR);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      window.clearInterval(timer);
    } else if (++tries > 20) {
      window.clearInterval(timer);
    }
  }, 100);
  return () => window.clearInterval(timer);
}

/**
 * Shown when the browser could not read the chosen file at all.
 *
 * It names Drive and iCloud on purpose. "That upload failed" sent two people
 * to re-export a CV that was fine — the file was never on the phone, and no
 * amount of retrying the upload was going to put it there.
 */
const CLOUD_FILE_HINT =
  "We could not read that file from your device. If you picked it from Google Drive, " +
  "iCloud or another cloud app, download it to the device first, then choose it again.";

/**
 * Public CV upload.
 *
 * Choosing a file and seeing what the tool does no longer requires an account.
 * The gate moved to the moment the file would actually be stored and parsed:
 * that is the point where we take on someone's personal data, so that is the
 * point where they get to decide.
 *
 * The selected file is deliberately NOT persisted across the sign-up round
 * trip. Stashing a CV in sessionStorage to survive a redirect would mean
 * writing someone's personal document to browser storage before they have
 * agreed to anything, which is exactly what this gate exists to prevent.
 */
export default function CvAnalyze({
  signedIn,
  parsedAt,
}: {
  signedIn: boolean;
  parsedAt: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askSignup, setAskSignup] = useState(false);
  /*
   * What the parse actually found.
   *
   * Reported twice, and they are the same bug: "אחרי הסריקה זה לא עושה כלום
   * ולכן חשבתי כמה פעמים שזה לא עבד" — after the scan nothing happens, so I
   * thought several times that it had not worked. The old success path was
   * `router.refresh()` and nothing else, which repaints a section far below
   * the fold and leaves the picker looking untouched. A second upload was
   * worse still: the progress display simply vanished with no result at all.
   */
  const [result, setResult] = useState<ParsedSummary | null>(null);

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ),
    [],
  );

  async function analyze() {
    if (!file) {
      inputRef.current?.click();
      return;
    }

    // Re-check the session rather than trusting the server-rendered prop: the
    // page may have been cached or the session may have expired since render.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setAskSignup(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      /*
       * READ THE BYTES BEFORE SENDING THEM.
       *
       * `body.append("file", file)` does not copy anything. On Android a file
       * chosen from Google Drive is a `content://` handle owned by another app,
       * and the bytes are only fetched when the request body is streamed. If
       * that read fails — Drive has not cached the file locally, the connection
       * drops, the provider is slow — `fetch` itself rejects, and the failure
       * arrives as a bare network error with no status and no response. It
       * lands in the catch below, which is why two people saw "That upload
       * failed" with nothing whatsoever on the server: no request, no row, no
       * log. Both were on Drive; one of them confirmed the same CV uploaded
       * fine from local storage.
       *
       * Pulling the bytes first moves the read out of the request. It usually
       * succeeds, because it can take as long as it needs without a socket
       * open; when it does fail, it fails HERE, where we can say what to do
       * about it instead of blaming the upload.
       */
      let bytes: ArrayBuffer;
      try {
        bytes = await file.arrayBuffer();
      } catch {
        setError(CLOUD_FILE_HINT);
        return;
      }
      /*
       * Zero bytes is the other shape of the same problem: some providers hand
       * over an empty stub rather than throwing. Caught here it is one clear
       * sentence; sent on, it becomes "we could not find enough text in that
       * file", which sends the reader off to re-export a CV that was never the
       * problem.
       */
      if (bytes.byteLength === 0) {
        setError(CLOUD_FILE_HINT);
        return;
      }

      const body = new FormData();
      body.append("file", new File([bytes], file.name, { type: file.type }));
      const res = await fetch("/api/cv", { method: "POST", body });

      /*
       * A 401 is not an upload failure, and telling someone their file failed
       * when their session lapsed sends them to re-export the CV. The check
       * above uses the browser's own session, so reaching here with a 401 means
       * the server disagreed — which is exactly the case worth handling, not
       * the case worth reporting as a bad file. Same modal the signed-out path
       * already uses.
       */
      if (res.status === 401) {
        setAskSignup(true);
        return;
      }

      /*
       * `.catch`, because a crashed or timed-out function answers with an HTML
       * error page and `res.json()` then throws. That threw into the catch
       * below and produced the same generic sentence as everything else, which
       * is how a 500 and a lapsed session became indistinguishable on screen.
       */
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "That upload failed. Please try again.");
        return;
      }
      /*
       * `draft`, not `parsed`.
       *
       * This read `json.parsed.seniority`, which `ParsedCv` has never had —
       * seniority is derived from years inside the route — so the seniority
       * line was permanently blank and nobody noticed, because a blank line
       * looks exactly like "we could not tell".
       *
       * `draft` is the profile as it now stands after the route's
       * edited-vs-leftover rules, which is what the person should be shown and
       * asked to confirm.
       */
      const draft = json.draft ?? json.parsed ?? {};
      setResult({
        skills: Array.isArray(draft.skills) ? draft.skills : [],
        jobFunction: draft.jobFunction ?? null,
        seniority: draft.seniority ?? null,
        seniorityLevels: Array.isArray(draft.seniorityLevels) ? draft.seniorityLevels : [],
        yearsExperience: draft.yearsExperience ?? null,
        yearsBasis: draft.yearsBasis ?? null,
        headline: draft.headline ?? null,
        currentTitle: draft.currentTitle ?? null,
        preferredTitles: Array.isArray(draft.preferredTitles) ? draft.preferredTitles : [],
        functionConfidence:
          typeof draft.functionConfidence === "number" ? draft.functionConfidence : null,
      });
      router.refresh();
    } catch {
      setError("That upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const goToMatches = useCallback(() => {
    document
      .getElementById(MATCHES_ANCHOR)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Only auto-scroll when there is something to scroll to. A parse that found
  // no skills renders no matches, and jumping the page to an empty section
  // would be worse than staying put.
  useEffect(() => {
    if (!result || result.skills.length === 0) return;
    return scrollToMatchesWhenReady();
  }, [result]);

  // While parsing, the picker is replaced rather than sitting disabled beside a
  // spinner: there is nothing useful to do during the wait, and a live progress
  // display is the more honest thing to show.
  if (busy) return <CvAnalyzing />;

  return (
    <div className="rounded-card border border-line bg-surface p-5 sm:p-6">
      {/*
        Say it is beta HERE, above the button, not in small print underneath.
        The reason to label it is that people act on the result — they decide
        which jobs to open — so being told the reading might be wrong is only
        useful before they trust it.
      */}
      <p className="m-0 mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-chip bg-accent-tint px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-accent-text">
          Beta
        </span>
        <span className="text-sm text-fg-2">
          This reads your CV with rules, not AI. It gets Hebrew CVs and career changes wrong
          sometimes — check what it found, and correct anything it missed.
        </span>
      </p>

      {/*
        The result, stated where the person is already looking. Without this
        the only feedback was a section repainting below the fold, which read
        as "nothing happened" — twice, to the same reader.
      */}
      {result ? (
        <CvReview draft={result} onSeeMatches={goToMatches} />
      ) : null}

      <input
        ref={inputRef}
        id="cv-file"
        name="cv-file"
        type="file"
        accept=".pdf,.docx,.txt,application/pdf,text/plain"
        aria-label="Choose a CV file: PDF, DOCX or TXT, up to 5MB"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setFile(f);
            setError(null);
          }
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" onClick={() => inputRef.current?.click()}>
          <Upload aria-hidden="true" className="size-[18px]" />
          {file ? "Choose a different file" : parsedAt ? "Replace CV" : "Choose your CV"}
        </Button>

        <Button type="button" onClick={analyze} disabled={busy || !file}>
          <Sparkles aria-hidden="true" className="size-[18px]" />
          {busy ? "Reading your CV…" : "Analyze"}
        </Button>
      </div>

      {file ? (
        <p className="m-0 mt-3 flex items-center gap-2 text-sm text-fg-2">
          <FileText aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{file.name}</span>
          <span className="numeral shrink-0">({Math.round(file.size / 1024)} KB)</span>
        </p>
      ) : (
        <p className="m-0 mt-3 text-sm text-fg-2">
          PDF, DOCX or TXT, up to 5MB.
          {signedIn ? " Choose a file to enable Analyze." : ""}
        </p>
      )}

      {/*
        Say the account is coming before they pick a file, not after. Being
        asked to sign up only once you have already chosen a document is the
        pattern that makes people feel baited.
      */}
      {!signedIn ? (
        <p className="m-0 mt-2 text-sm text-fg-2">
          Analyzing needs a free account. Searching does not.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="m-0 mt-3 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text"
        >
          {error}
        </p>
      ) : null}

      <p className="m-0 mt-4 border-t border-line pt-3 text-xs text-fg-2">
        Your file is stored in a private bucket that only you can read. It is never shown to
        employers and never sent anywhere. Deleting your account deletes it too.
      </p>

      <Modal open={askSignup} onClose={() => setAskSignup(false)} title="Create a free account">
        <p className="m-0 text-fg-2">
          Matching reads your CV and keeps the extracted skills on your profile, so it needs
          somewhere to keep them. Creating an account takes an email and a six-digit code —
          no password.
        </p>
        <p className="m-0 mt-3 font-medium">
          Free for job seekers, forever. We never charge anyone looking for work.
        </p>
        {/*
          Say the file will not survive the trip. It is deliberately not stashed
          in browser storage — that would mean writing someone's CV to their
          device before they have agreed to anything — but the consequence is
          that people come back to an empty picker and a disabled button, which
          looks like the upload failed. Better to warn than to surprise.
        */}
        <p className="m-0 mt-3 text-sm text-fg-2">
          You will need to choose your file again afterwards. We do not keep it anywhere
          until you have agreed, and that includes your own browser.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/auth/login?next=%2Fmatch"
            className="inline-flex min-h-11 items-center justify-center rounded-control bg-action px-5 py-2.5 font-medium text-on-action transition-colors hover:bg-action-hover"
          >
            Continue with email
          </Link>
          <Button type="button" variant="ghost" onClick={() => setAskSignup(false)}>
            Not now
          </Button>
        </div>
        <p className="m-0 mt-4 text-xs text-fg-2">
          You can keep searching without an account. Sign-up is only needed for CV matching,
          saved jobs and application tracking.
        </p>
      </Modal>
    </div>
  );
}
