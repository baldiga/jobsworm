import { Spinner } from "@/components/ui/Spinner";

/**
 * Shown while any /recruit page is being fetched.
 *
 * Next renders this automatically during a route transition, which is the one
 * place the recruiter flow had no feedback at all: submitting a listing,
 * opening a campaign or going to pay all navigate to a server-rendered page,
 * and until it arrived the previous screen simply sat there looking ignored.
 *
 * One file covers every page under /recruit, including the nested ones.
 */
export default function RecruitLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-[1120px] items-center gap-3 px-4 py-16 text-fg-2 sm:px-6"
      role="status"
    >
      <Spinner />
      <span className="text-sm">Loading…</span>
    </div>
  );
}
