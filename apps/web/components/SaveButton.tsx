"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Bookmark, BookmarkCheck } from "lucide-react";

/**
 * Save / unsave a job.
 *
 * This component and /api/save were both dead code: nothing imported the one
 * and nothing fetched the other, while /me rendered a full saved-jobs section
 * and the PWA shipped a shortcut to it. The feature was advertised in two
 * places and reachable from none. The route has been deleted — it hand-rolled
 * its own insert against `saved_jobs`, whereas this path calls the
 * `toggle_saved_job` RPC that `my_saved_jobs` is built around.
 *
 * Auth and saved state are resolved on the client rather than passed in as
 * props, so the job page stays statically cacheable (`revalidate = 3600`).
 * Reading a cookie in that page to prepopulate this button would have made
 * every job page dynamic, which is the wrong trade for a per-user bookmark.
 */
export default function SaveButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ),
    [],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!alive) return;
      if (!user) {
        setSignedIn(false);
        return;
      }
      setSignedIn(true);
      const { data } = await supabase
        .from("saved_jobs")
        .select("id")
        .eq("job_id", jobId)
        .maybeSingle();
      if (alive) setSaved(Boolean(data));
    })();
    return () => {
      alive = false;
    };
  }, [supabase, jobId]);

  const toggle = useCallback(async () => {
    if (signedIn === false) {
      router.push(`/auth/login?next=${encodeURIComponent(`/jobs/${jobId}`)}`);
      return;
    }
    setBusy(true);
    const previous = saved;
    setSaved(!previous); // optimistic
    try {
      const { data, error } = await supabase.rpc("toggle_saved_job", { p_job_id: jobId });
      if (error) throw error;
      setSaved(Boolean(data));
    } catch {
      setSaved(previous); // roll back
    } finally {
      setBusy(false);
    }
  }, [signedIn, saved, supabase, jobId, router]);

  const Icon = saved ? BookmarkCheck : Bookmark;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={saved}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-control border px-5 py-3 font-medium transition-colors disabled:opacity-60 ${
        saved
          ? "border-action bg-accent-tint text-accent-text"
          : "border-line-strong text-fg hover:bg-surface-2"
      }`}
    >
      {/* A bookmark is not directional and must not mirror under RTL. */}
      <Icon aria-hidden="true" className="size-[18px] shrink-0" />
      {saved ? "Saved" : "Save"}
    </button>
  );
}
