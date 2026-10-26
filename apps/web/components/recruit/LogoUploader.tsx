"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * The company logo, set once on the profile.
 *
 * Set here rather than on the posting form because it belongs to the account,
 * not the listing: a recruiter posting their fourth role should not be asked
 * for their logo a fourth time. Each listing copies whatever is set at the
 * moment it is posted.
 *
 * The file is checked on the server by its actual bytes, not its name — see
 * the upload route. The `accept` attribute here is a convenience for the file
 * picker and nothing more; it is trivially bypassed and is not relied on.
 */
export default function LogoUploader({ currentUrl }: { currentUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(currentUrl);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/recruit/logo", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not upload that.");
        return;
      }
      /*
       * The object name is fixed per recruiter, so a replacement lands at the
       * same URL and every cache between here and the browser still holds the
       * old picture. The query string is not part of the stored object; it
       * exists only to make this <img> miss those caches.
       */
      setUrl(json.url ? `${json.url}?v=${Date.now()}` : null);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt="Your company logo"
          className="size-16 rounded-control border border-line bg-surface object-contain p-1"
        />
      ) : (
        <div className="flex size-16 items-center justify-center rounded-control border border-dashed border-line text-xs text-fg-2">
          None
        </div>
      )}

      <div className="grid gap-1">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? "Uploading…" : url ? "Replace logo" : "Upload a logo"}
        </Button>
        <span className="text-xs text-fg-2">PNG or JPEG, up to 512KB.</span>
        {error ? (
          <span role="alert" className="text-xs text-warn-text">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
