import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Chip } from "@/components/ui/Chip";
import { formatUsd } from "@/lib/format";

export const metadata: Metadata = {
  title: "Campaigns",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  kind: string;
  plan: string;
  status: string;
  buyer_name: string | null;
  title_snapshot: string | null;
  job_id: string | null;
  days: number;
  price_usd: number | string;
  paid_at: string | null;
  created_at: string;
  recruiters: { org_name: string; email_domain: string; status: string } | null;
  jobs: { quality_flags: string[] | null; salary: { min?: number; max?: number } | null } | null;
};

/**
 * The review queue.
 *
 * ## Free listings are here too
 *
 * They went live without anyone reading them — that is what makes the free
 * tier usable — so this is the only place they are ever looked at. A queue
 * that showed paid submissions alone would mean the unreviewed half of the
 * index is also the invisible half, which is precisely backwards.
 *
 * The ordering reflects that: things waiting on a decision first, then live
 * free listings carrying a flag, then everything else.
 */
export default async function AdminCampaignsPage() {
  await requireAdmin();

  const admin = createAdminClient();
  const { data } = await admin
    .from("campaigns")
    .select(
      "id, kind, plan, status, buyer_name, title_snapshot, job_id, days, price_usd, paid_at, created_at, recruiters(org_name, email_domain, status), jobs(quality_flags, salary)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data as Row[] | null) ?? [];
  /*
   * Three queues, not one sorted list.
   *
   * The list was ordered by urgency and that was better than nothing, but it
   * left the decisions, the running listings and the finished ones in one
   * scroll — so "is there anything to do?" meant reading the status column of
   * every row. These are three different questions asked at different times,
   * and the count in each heading answers the first one without reading
   * anything.
   */
  const waiting = rows.filter(
    (r) =>
      r.status === "pending_review" ||
      (r.status === "approved" && !r.paid_at) ||
      r.status === "draft" ||
      // A free listing that went live carrying a flag was never read by
      // anybody. It belongs with the decisions, not with the running ads.
      (r.plan === "free" && r.status === "live" && Boolean(r.jobs?.quality_flags?.length)),
  );
  const waitingIds = new Set(waiting.map((r) => r.id));
  const running = rows.filter((r) => r.status === "live" && !waitingIds.has(r.id));
  const finished = rows.filter((r) =>
    ["ended", "refunded", "cancelled", "rejected"].includes(r.status),
  );

  return (
    <PageShell width="full">
      <SectionHeading
        level={1}
        title="Campaigns"
        subtitle={`${rows.length} listings. ${waiting.length} waiting on you.`}
      />

      <Queue
        title="Waiting on you"
        rows={waiting}
        empty="Nothing to decide. Every listing is either running or finished."
      />
      <Queue title="Running now" rows={running} empty="No listing is live." />
      <Queue title="Finished" rows={finished} empty="Nothing has finished yet." />
    </PageShell>
  );
}

/** One titled table. Identical columns in each, so the eye does not relearn. */
function Queue({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg">
        {title}{" "}
        <span className="numeral text-sm font-normal text-fg-2">({rows.length})</span>
      </h2>

      {!rows.length ? (
        <p className="m-0 mt-2 text-sm text-fg-2">{empty}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-fg-2">
                <th scope="col" className="py-2 pr-3 font-medium">Listing</th>
                <th scope="col" className="py-2 pr-3 font-medium">Buyer</th>
                <th scope="col" className="py-2 pr-3 font-medium">Plan</th>
                <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2 pr-3 font-medium">Salary</th>
                <th scope="col" className="py-2 pr-3 font-medium">Flags</th>
                <th scope="col" className="py-2 font-medium">Paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 align-top">
                  <th scope="row" className="py-3 pr-3 font-medium">
                    <Link href={`/admin/campaigns/${r.id}`} className="hover:underline">
                      {r.title_snapshot ?? "Untitled"}
                    </Link>
                  </th>
                  <td className="py-3 pr-3">
                    {r.recruiters?.org_name ?? r.buyer_name ?? "—"}
                    {/*
                      The email domain is the cheapest evidence of who this
                      actually is, and the one column worth scanning down.
                    */}
                    <span className="numeral mt-0.5 block text-xs text-fg-2" dir="ltr">
                      {r.recruiters?.email_domain ?? "—"}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    <Chip tone={r.plan === "free" ? "info" : "accent"}>
                      {r.plan === "free" ? "Free" : `${r.days}d`}
                    </Chip>
                    {r.kind === "agency" ? <Chip tone="warn">Agency</Chip> : null}
                  </td>
                  <td className="py-3 pr-3">{r.status}</td>
                  <td className="numeral py-3 pr-3" dir="ltr">
                    {r.jobs?.salary?.min
                      ? `₪${r.jobs.salary.min.toLocaleString("en-IL")}–${(r.jobs.salary.max ?? r.jobs.salary.min).toLocaleString("en-IL")}`
                      : "—"}
                  </td>
                  <td className="py-3 pr-3">
                    {r.jobs?.quality_flags?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {r.jobs.quality_flags.map((f) => (
                          <Chip key={f} tone="warn">
                            {f}
                          </Chip>
                        ))}
                      </span>
                    ) : (
                      <span className="text-fg-2">—</span>
                    )}
                  </td>
                  <td className="numeral py-3">
                    {r.plan === "free" ? (
                      <span className="text-fg-2">Free</span>
                    ) : r.paid_at ? (
                      formatUsd(r.price_usd)
                    ) : (
                      <span className="text-warn-text">{formatUsd(r.price_usd)} unpaid</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
