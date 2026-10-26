import { WormMark } from "./Worm";

/**
 * "We are digging." A worm orbiting a ring of soil.
 *
 * Used wherever a search is in flight. It carries a `role="status"` and a
 * visually hidden label, so it announces itself rather than being a decoration
 * that only sighted users benefit from.
 */
export function WormSpinner({
  size = 44,
  label = "Searching",
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`worm-spin ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <span aria-hidden="true" className="worm-spin__orbit">
        <span className="worm-spin__worm">
          <WormMark size={Math.round(size * 0.55)} />
        </span>
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The spinner with its label shown, for a full-panel loading state. */
export function WormLoading({ label = "Digging up jobs" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14">
      <WormSpinner size={56} label={label} />
      <p className="m-0 text-sm font-medium text-fg-2">{label}…</p>
    </div>
  );
}
