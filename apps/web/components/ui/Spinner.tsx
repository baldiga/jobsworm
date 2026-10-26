/**
 * A small spinner for buttons and panels that are waiting on the network.
 *
 * `aria-hidden`, always: every use of this sits next to text that already
 * changed to say what is happening ("Saving…", "Opening the payment window…").
 * A screen reader announcing "image" or "progressbar" on top of that is noise,
 * and the text is the accessible status.
 *
 * `currentColor`, so it inherits whatever it is placed in without a variant
 * for every button style.
 */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`size-4 shrink-0 animate-spin ${className}`}
    >
      {/* The track, faint; the arc, solid. One rotation reads as motion. */}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
