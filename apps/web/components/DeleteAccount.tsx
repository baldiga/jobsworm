"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/**
 * One-click delete, as promised in Consent A (PLAN.md section 8).
 * Two steps so it cannot be hit by accident, but no dark patterns:
 * no "are you sure you want to lose everything", no retention offer.
 */
export default function DeleteAccount() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { error: rpcError } = await supabase.rpc("delete_my_account");
      if (rpcError) throw rpcError;

      // Removes the auth user itself, which the RPC cannot reach.
      await fetch("/api/account", { method: "DELETE" });
      await supabase.auth.signOut();
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-control px-4 py-2 text-sm text-bad underline underline-offset-2"
      >
        Delete account
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-fg-2">Delete everything?</span>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="min-h-11 rounded-control bg-bad px-3 py-2 text-sm font-medium text-on-action transition-colors disabled:opacity-60"
      >
        {busy ? "Deleting…" : "Yes, delete"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="rounded-control px-3 py-2 text-sm text-fg-2"
      >
        Cancel
      </button>
      {error ? <span className="text-sm text-bad">{error}</span> : null}
    </div>
  );
}
