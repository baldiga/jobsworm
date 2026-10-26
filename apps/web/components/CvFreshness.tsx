"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * The 90-day promise, kept out loud.
 *
 * `consent.ts` tells everybody who signs up that their CV stops being used for
 * matching after ninety days. Until 0044 nothing enforced it; now it does, and
 * enforcing a rule silently is its own failure — somebody whose matches
 * vanished with no explanation would reasonably conclude the site was broken.
 *
 * So: a warning from fifteen days out, and a clear statement once it has
 * passed, with one button that fixes it.
 *
 * The CV is not deleted. The wording says "stopped being used" rather than
 * anything about removal, because that is what actually happened — deletion is
 * what the delete-account button is for, and implying it here would be a
 * different promise from the one we made.
 */

const WARN_FROM_DAYS = 15;

export default function CvFreshness({ daysLeft }: { daysLeft: number | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (daysLeft === null || done || daysLeft > WARN_FROM_DAYS) return null;

  const expired = daysLeft <= 0;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/confirm-cv", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError("Could not do that. Try re-uploading your CV instead.");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className={`mb-6 rounded-card border p-4 ${
        expired ? "border-warn-text bg-warn-tint text-warn-text" : "border-line bg-surface"
      }`}
    >
      <p className="m-0 font-semibold">
        {expired
          ? "Your CV has stopped being used for matching."
          : `Your CV stops being used for matching in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}.`}
      </p>
      <p className="m-0 mt-1.5 text-sm">
        {expired
          ? "We promised that CVs stop being used after 90 days, and that is what has happened here. Your CV has not been deleted — it is simply no longer matching. One click starts it again."
          : "We promised that CVs stop being used after 90 days. Confirm it is still current and it keeps going for another 90."}
      </p>

      {error ? (
        <p role="alert" className="m-0 mt-2 text-sm text-warn-text">
          {error}
        </p>
      ) : null}

      <div className="mt-3">
        <Button type="button" size="sm" onClick={confirm} disabled={busy}>
          {busy ? "Confirming…" : "Still current — keep matching"}
        </Button>
      </div>
    </div>
  );
}
