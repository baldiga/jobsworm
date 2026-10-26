import { WormLoading } from "@/components/ui/WormSpinner";

/**
 * Shown while /jobs renders.
 *
 * The page is `force-dynamic` and runs three RPCs, so there is a real gap
 * between a click and results — around half a second on a warm database, longer
 * on a cold one. Next renders this automatically during that gap, which turns
 * the pause from "nothing happened" into "it is working".
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6">
      <WormLoading label="Digging up jobs" />
    </div>
  );
}
