"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * "My area", as a person icon — plus your name when you are signed in.
 *
 * ## Why it asks the server instead of being told
 *
 * The header is in the root layout, and reading the session there makes every
 * page dynamic: the home page loses its ISR cache and every visitor pays a
 * Supabase round trip so that one corner of the screen can show a name. That
 * is measured, not theoretical — it took the site from nine statically
 * rendered routes to four when it was tried.
 *
 * So the page ships static and this asks afterwards. A signed-out visitor sees
 * the icon and never learns anything happened; a signed-in one sees their name
 * appear a moment later.
 *
 * ## Why it renders the icon before it knows
 *
 * There is no spinner and no skeleton. The icon is the same either way, so
 * showing it immediately and adding the name when it arrives means the header
 * never reflows for a signed-out visitor and grows once for a signed-in one.
 * A placeholder sized for a name would do the opposite: reserve space that
 * most visitors never fill.
 */
export default function AccountChip({ onNavigate }: { onNavigate?: () => void }) {
  const [name, setName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        const signedIn = Boolean(j?.signedIn) && typeof j.name === "string";
        setName(signedIn ? j.name : null);
        setIsAdmin(signedIn && j.isAdmin === true);
      })
      // Signed in or not is not worth an error state. On a failure the header
      // stays as it is for a signed-out visitor, and nothing else breaks.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    /*
     * Re-checked on navigation, so signing in or out is reflected without a
     * full reload — /auth/login and /auth/signout both leave you on a new path.
     */
  }, [pathname]);

  return (
    <>
      {/*
        Drawn from the same answer that carries the name, so the header still
        makes one request and the layout still renders statically. It decides
        the LINK only — /admin calls requireAdmin() and 404s on its own, so
        this being wrong costs a link to nowhere and nothing else.
      */}
      {isAdmin ? (
        <Link
          href="/admin"
          onClick={onNavigate}
          className="inline-flex min-h-11 items-center rounded-control px-2.5 py-2 font-medium text-fg-2 transition-all duration-100 hover:bg-surface-2 hover:text-fg active:scale-95 active:bg-surface-2 active:text-fg"
        >
          Admin
        </Link>
      ) : null}
    <Link
      href="/me"
      onClick={onNavigate}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 py-2 text-fg-2 transition-all duration-100 hover:bg-surface-2 hover:text-fg active:scale-95 active:bg-surface-2 active:text-fg"
      /*
       * The accessible name says "My area" either way. An icon on its own is
       * unlabelled to a screen reader, and the green capsule is decoration
       * around a fact the name already carries.
       */
      aria-label={name ? `My area, signed in as ${name}` : "My area"}
    >
      <PersonIcon />
      {name ? (
        <span
          className="max-w-[7.5rem] truncate rounded-full bg-action px-2 py-0.5 text-xs font-medium text-on-action"
          /* Already in the link's aria-label; reading it twice is noise. */
          aria-hidden="true"
        >
          {name}
        </span>
      ) : null}
    </Link>
    </>
  );
}

function PersonIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
