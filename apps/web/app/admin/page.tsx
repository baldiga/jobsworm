import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const { email } = await requireAdmin();
  const admin = createAdminClient();

  /*
   * Two counts, chosen because they are the two things that go wrong if
   * nobody looks: a buyer waiting on a decision, and a free listing that went
   * up unread and tripped a flag on the way.
   */
  const [{ count: pending }, { count: flagged }, { count: unmatched }] = await Promise.all([
    admin
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending_review"),
    admin
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("plan", "free")
      .eq("status", "live"),
    admin
      .from("payment_events")
      .select("event_id", { count: "exact", head: true })
      .eq("processed", false),
  ]);

  return (
    <PageShell width="narrow">
      <SectionHeading level={1} title="Admin" subtitle={email} />
      <ul className="mt-6 grid list-none gap-3 p-0">
        <li className="rounded-card border border-line bg-surface p-4">
          <Link href="/admin/campaigns" className="font-medium hover:underline">
            Campaigns
          </Link>
          <p className="m-0 mt-1 text-sm text-fg-2">
            {pending ?? 0} waiting for review · {flagged ?? 0} free listings live
          </p>
        </li>
        <li className="rounded-card border border-line bg-surface p-4">
          <Link href="/admin/payments" className="font-medium hover:underline">
            Payments
          </Link>
          <p className="m-0 mt-1 text-sm text-fg-2">
            {unmatched ?? 0} unmatched
            {(unmatched ?? 0) > 0 ? " — somebody paid and is waiting" : ""}
          </p>
        </li>
      </ul>
    </PageShell>
  );
}
