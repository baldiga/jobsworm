import { cn } from "./cn";

/*
 * One mascot block, replacing four copies at three different image sizes plus
 * three bare paragraphs that had no mascot at all.
 *
 * Empty states, loading and errors are the only places Wormy is allowed. He
 * never appears in a job card, beside a salary figure, next to a privacy
 * claim, or on a button.
 *
 * The image is decorative and carries alt="" so a screen reader skips it and
 * lands on the heading, which is the actual message.
 */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-card border border-line bg-surface p-8 text-center", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/mascot-256.png"
        alt=""
        width={88}
        height={88}
        className="mx-auto mb-4 h-22 w-auto"
      />
      <h3 className="mb-2">{title}</h3>
      {children ? <div className="mx-auto max-w-[46ch] text-fg-2">{children}</div> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
