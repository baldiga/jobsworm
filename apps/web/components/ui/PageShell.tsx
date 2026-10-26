import { cn } from "./cn";

/*
 * One place for the four max-width variants that were being retyped per page.
 *
 * `prose` is 640px rather than a `ch` value on purpose: `ch` is the advance
 * width of "0", which has no relationship to Hebrew glyph widths, so a measure
 * that reads correctly in English runs 15-20% long in Hebrew.
 */
const WIDTHS = {
  prose: "max-w-[640px]",
  narrow: "max-w-3xl",
  wide: "max-w-5xl",
  full: "max-w-[1120px]",
} as const;

export function PageShell({
  width = "wide",
  className,
  children,
}: {
  width?: keyof typeof WIDTHS;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full px-4 py-8 sm:px-6", WIDTHS[width], className)}>
      {children}
    </div>
  );
}
