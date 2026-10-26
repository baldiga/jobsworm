"use client";

import { useEffect, useState } from "react";

/**
 * Wormy, drawn rather than photographed.
 *
 * The mascot PNG is a raster and gets soft at small sizes, and it carries its
 * own near-white background which shows against the warm ground. This is an
 * inline SVG so it stays crisp, inherits `currentColor`, and costs no request.
 */
export function WormMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size * 0.62}
      viewBox="0 0 100 62"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Body: one stroked path, so the segments are dashes rather than shapes. */}
      <path
        d="M6 44c0-12 12-18 20-12s6 18 16 20 20-6 20-18-8-20-2-26"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
      />
      <path
        d="M6 44c0-12 12-18 20-12s6 18 16 20 20-6 20-18-8-20-2-26"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray="1 14"
      />
      {/* Eye. One is enough at this size; two read as a face and fight the logo. */}
      <circle cx="64" cy="10" r="3.4" fill="var(--color-bg, #FBFAF7)" />
      <circle cx="64.9" cy="10.6" r="1.7" fill="currentColor" />
    </svg>
  );
}

/**
 * A worm that crosses the page occasionally.
 *
 * Deliberately rare and deliberately cheap: one absolutely-positioned element
 * animating transform and opacity only, mounted just long enough to cross and
 * then unmounted. It is aria-hidden and pointer-events-none, so it cannot be
 * tabbed to, read out, or intercept a click on a job.
 *
 * Respects prefers-reduced-motion by never scheduling at all — the global CSS
 * rule would collapse the animation to nothing, which would leave a worm
 * parked mid-screen rather than absent.
 */
export function WormCrossing() {
  const [run, setRun] = useState<{ id: number; top: number; secs: number } | null>(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let timer: ReturnType<typeof setTimeout>;
    let alive = true;

    const schedule = () => {
      // 45-105s apart. Often enough to be noticed once, rare enough that it
      // never becomes something to wait out while reading a listing.
      const wait = 45_000 + Math.random() * 60_000;
      timer = setTimeout(() => {
        if (!alive) return;
        const secs = 13 + Math.random() * 6;
        setRun({
          id: Date.now(),
          // Keep clear of the sticky header and the very bottom edge.
          top: 22 + Math.random() * 58,
          secs,
        });
        setTimeout(() => alive && setRun(null), secs * 1000);
        schedule();
      }, wait);
    };

    schedule();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  if (!run) return null;

  return (
    <div
      key={run.id}
      aria-hidden="true"
      className="worm-cross text-action/35"
      style={{ top: `${run.top}vh`, ["--worm-duration" as string]: `${run.secs}s` }}
    >
      <WormMark size={34} />
    </div>
  );
}

/** A chewed hole in the paper. Decorative only. */
export function Wormhole({ size = 10, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`wormhole inline-block ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}

/** A leaf with a bite out of it. Decorative only. */
export function BittenLeaf({
  size = 16,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={`leaf inline-block ${className ?? ""}`}
      style={{ width: size, height: size, ...style }}
    />
  );
}
