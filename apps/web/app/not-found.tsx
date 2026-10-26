import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/**
 * Custom 404.
 *
 * This one gets hit for real: job pages are removed as soon as a listing closes
 * at the source, so anyone following an old link or a stale search-engine
 * result lands here. The copy says that rather than just "not found", and sends
 * them back to search instead of to a dead end.
 */
export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-20 sm:px-6">
      <EmptyState
        title="This page isn't here"
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink href="/jobs">Search jobs</ButtonLink>
            <ButtonLink href="/" variant="ghost">
              Go home
            </ButtonLink>
          </div>
        }
      >
        <p className="m-0">
          If you were following a link to a job, it has probably closed. We remove listings as
          soon as they disappear from the employer, rather than leaving them up to collect
          clicks.
        </p>
      </EmptyState>
    </div>
  );
}
