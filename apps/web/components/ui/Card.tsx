import { cn } from "./cn";

/*
 * Replaces thirteen hand-typed card strings.
 *
 * A newsprint card is a hairline rule, never a shadow. The system has no
 * box-shadow at all — a raised, rounded, shadowed rectangle is the thing that
 * makes a page read as a component kit rather than as a printed sheet.
 */
export function Card({
  as: Tag = "article",
  interactive = false,
  muted = false,
  className,
  children,
}: {
  as?: "article" | "div" | "section" | "li";
  /** Adds the hover rule used by cards that are themselves links. */
  interactive?: boolean;
  /** Dims the whole card, for jobs that have closed. */
  muted?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "rounded-card border border-line bg-surface p-4",
        interactive && "transition-colors hover:border-line-strong",
        muted && "opacity-60",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
