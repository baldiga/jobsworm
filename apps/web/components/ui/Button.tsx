import Link from "next/link";
import { cn } from "./cn";

/*
 * Replaces eight hand-typed button strings across four different padding
 * scales, two of which had no transition at all.
 *
 * Every size clears a 44px touch target. `secondary` uses border-action rather
 * than text-action because copper as a border is non-text (needs 3:1, has
 * 4.45) while copper as a label under 24px would fail AA — the label is
 * text-action-text instead.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-action text-on-action hover:bg-action-hover border border-transparent",
  secondary: "border border-action text-action-text bg-transparent hover:bg-accent-tint",
  ghost: "border border-line text-fg bg-surface hover:border-line-strong",
  danger: "border border-bad text-bad bg-transparent hover:bg-bad hover:text-surface",
};

const SIZES: Record<Size, string> = {
  sm: "min-h-11 px-3 py-2 text-sm",
  md: "min-h-11 px-4 py-2.5 text-base",
  lg: "min-h-12 px-6 py-3 text-base",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium " +
  "transition-colors disabled:opacity-60 disabled:pointer-events-none";

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...rest}>
      {children}
    </button>
  );
}

/** Same shape as Button, rendered as a Next link. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  href,
  ...rest
}: CommonProps & { href: string } & Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    "href"
  >) {
  return (
    <Link href={href} className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...rest}>
      {children}
    </Link>
  );
}
