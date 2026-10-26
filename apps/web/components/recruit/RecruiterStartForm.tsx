"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import LogoUploader from "./LogoUploader";

/**
 * Registering as a recruiter. Two questions, then an optional logo.
 *
 * ## There is no "are you an employer or an agency?" any more
 *
 * There was, and the answer set `is_agency` on every job the account posted —
 * which kept agency listings out of organic search and confined them to
 * sponsored slots. Treating the two as one thing removes the distinction
 * entirely: everyone is a recruiter, every listing is eligible for the same
 * surfaces, and nobody has to classify themselves on a form before they have
 * posted anything.
 *
 * The signal is not lost. `looksLikeAgency` still reads the listing itself and
 * flags one that reads like an agency post, which was always the more reliable
 * evidence than asking — a radio button records what somebody selected, not
 * what they are.
 *
 * ## The logo comes after the account exists, not before
 *
 * It uploads to a path named for the user and updates the recruiter row, so
 * there has to BE a recruiter row first. Hence two panels rather than one
 * form: create the account, then offer the logo. It is skippable, because a
 * logo is not worth standing between somebody and their first listing.
 */
export default function RecruiterStartForm({ email }: { email: string }) {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/recruit/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `kind` is still sent, and is always "employer". The column and its
        // check constraint remain; nothing asks the question any more.
        body: JSON.stringify({
          kind: "employer",
          org_name: orgName.trim(),
          website: website.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not create the account.");
        return;
      }
      setCreated(true);
      // So the logo step, and anything else reading the recruiter row, sees it.
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="grid gap-5">
        <div className="rounded-card border border-line bg-surface p-4 sm:p-6">
          <h2 className="mt-0 text-lg">Account created</h2>
          <p className="m-0 mt-1 text-sm text-fg-2">
            Add your logo and it will appear on every listing you post, beside the role title.
            You can do this later from your dashboard.
          </p>
          <div className="mt-4">
            <LogoUploader currentUrl={null} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="/recruit/new" size="lg">
            Post your first job
          </ButtonLink>
          <ButtonLink href="/recruit/dashboard" variant="ghost">
            Go to the dashboard
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <label className="grid gap-1.5">
        <span className="font-medium">
          Company name
          <span aria-hidden="true" className="ms-1 font-normal text-bad">
            *
          </span>
        </span>
        <input
          required
          maxLength={120}
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          className="min-h-11 rounded-control border border-line bg-surface px-3"
        />
        <span className="text-xs text-fg-2">
          Shown on your listings. You can use a different name on any individual listing.
        </span>
      </label>

      <label className="grid gap-1.5">
        <span className="font-medium">
          Website <span className="font-normal text-fg-2">(optional)</span>
        </span>
        <input
          type="url"
          placeholder="https://"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="min-h-11 rounded-control border border-line bg-surface px-3"
        />
      </label>

      <p className="m-0 text-sm text-fg-2">
        Signed in as <span className="numeral">{email}</span>.
      </p>

      {error ? (
        <p role="alert" className="m-0 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text">
          {error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="lg" disabled={busy || orgName.trim().length < 2}>
          {busy ? <Spinner className="me-2" /> : null}
          {busy ? "Creating…" : "Create the account"}
        </Button>
      </div>
    </form>
  );
}
