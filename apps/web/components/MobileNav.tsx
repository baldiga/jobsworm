"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The main navigation on a phone.
 *
 * Three links fitted across the top on a wide screen and were cramped on a
 * narrow one, competing with the wordmark for a row that is only so wide. They
 * move behind a button here and the header keeps the logo, the account icon
 * and one control.
 *
 * ## Rendered on every screen, hidden by CSS on wide ones
 *
 * Not switched on a width read in JavaScript. A `useEffect` that measures the
 * viewport runs after hydration, so the first paint is always the wrong one —
 * a phone briefly shows the desktop bar, or a laptop flashes a hamburger. The
 * `sm:hidden` / `hidden sm:flex` pair is decided by CSS before anything runs.
 *
 * ## Closing
 *
 * On route change, on Escape, and on a click outside. Leaving a menu open over
 * the page you just navigated to is the standard way this goes wrong: the link
 * works, the panel stays, and the page looks frozen behind it.
 *
 * The route-change close is derived rather than done in an effect. What is
 * stored is the path the panel was opened on, and it counts as open only while
 * that still matches — so navigating anywhere closes it as a consequence of
 * rendering, with no effect to fire and no extra render to cascade from.
 */
export default function MobileNav({
  items,
}: {
  items: readonly { href: string; label: string }[];
}) {
  const pathname = usePathname();
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Open only while we are still on the path it was opened from.
  const open = openedAt !== null && openedAt === pathname;
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenedAt(null);
      // Focus goes back to the button that opened it, or it lands on <body>
      // and a keyboard user has to tab from the top of the document again.
      buttonRef.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpenedAt(null);
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="sm:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-fg-2 transition-all duration-100 hover:bg-surface-2 hover:text-fg active:scale-95 active:bg-surface-2"
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>

      {/*
        `hidden` rather than unmounted, so the links are in the document for a
        crawler and for find-in-page even while the panel is shut.
      */}
      <div
        id="mobile-nav"
        ref={panelRef}
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-line bg-bg shadow-sm"
      >
        <nav aria-label="Main" className="mx-auto grid w-full max-w-[1120px] gap-0.5 px-4 py-2">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center rounded-control px-2 py-2 font-medium text-fg-2 transition-all duration-100 hover:bg-surface-2 hover:text-fg active:scale-95 active:bg-surface-2 active:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
