import { cn } from "./cn";

/*
 * Replaces five separate chip implementations whose padding had drifted across
 * px-2.5/px-3 and py-1/py-1.5.
 *
 * Radius is 2px, not a pill. A `rounded-full` tag is the single loudest
 * generic tell available; the same chip at 2px reads as a printed tag.
 *
 * Contents go in <bdi> because chip labels are the most mixed-script text on
 * the page — "DevOps ו-SRE", "React", "מהבית" — and a Latin token at the edge
 * of a Hebrew run reorders without an isolate.
 */

type Tone = "plain" | "accent" | "info" | "warn" | "ok";

const TONES: Record<Tone, string> = {
  plain: "bg-surface-2 text-fg-2 border-transparent",
  accent: "bg-accent-tint text-accent-text border-transparent",
  info: "bg-info-tint text-info-text border-transparent",
  warn: "bg-warn-tint text-warn-text border-transparent",
  ok: "bg-transparent text-ok border-ok",
};

const BASE =
  "inline-flex items-center gap-1.5 rounded-chip border px-2 py-0.5 text-[13px] leading-6";

export function Chip({
  tone = "plain",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cn(BASE, TONES[tone], className)}>{children}</span>;
}

/**
 * The toggle form, used by the filter rail and the profile editor. Selected
 * state is carried by aria-pressed as well as colour, so it survives both
 * screen readers and forced-colours mode.
 */
export function ChipToggle({
  selected,
  onClick,
  className,
  children,
  ...rest
}: {
  selected: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className">) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        BASE,
        "min-h-9 cursor-pointer px-2.5 transition-colors",
        selected
          ? "border-action bg-accent-tint font-medium text-accent-text"
          : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
