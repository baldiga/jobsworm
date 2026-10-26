import { cn } from "./cn";

/*
 * Replaces nine retyped heading blocks.
 *
 * The kicker is the newsprint substitute for an all-caps eyebrow label:
 * Hebrew has no case, so `text-transform: uppercase` is a silent no-op on
 * Hebrew and would only mangle any Latin token inside it. A small serif line
 * in copper does the same job and actually works in both scripts.
 */
export function SectionHeading({
  kicker,
  title,
  subtitle,
  level = 2,
  className,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  level?: 1 | 2;
  className?: string;
}) {
  const Title = level === 1 ? "h1" : "h2";
  return (
    <div className={cn("mb-4", className)}>
      {kicker ? (
        <p className="m-0 mb-1.5 font-[family-name:var(--font-display)] text-[13px] font-bold text-action-text">
          {kicker}
        </p>
      ) : null}
      <Title>{title}</Title>
      {subtitle ? <p className="m-0 mt-2 max-w-[640px] text-fg-2">{subtitle}</p> : null}
    </div>
  );
}
