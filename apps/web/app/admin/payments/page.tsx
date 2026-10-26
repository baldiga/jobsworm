import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import AttachPayment from "@/components/admin/AttachPayment";

export const metadata: Metadata = { title: "Payments", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type EventRow = {
  provider: string;
  event_id: string;
  event_type: string | null;
  campaign_id: string | null;
  payload: Record<string, unknown>;
  received_at: string;
};

type CampaignOption = {
  id: string;
  title_snapshot: string | null;
  price_usd: number | string;
  days: number;
  buyer_name: string | null;
};

/**
 * Payments that arrived and could not be placed.
 *
 * The webhook tries the custom field, then a recent `pending_checkouts` row.
 * When both miss, the event is stored unprocessed rather than dropped — a
 * payment nobody can match is still a payment somebody made, and the person
 * who made it is waiting for a listing.
 *
 * This page is that backstop. It should almost always be empty; when it is
 * not, somebody is owed something.
 */
export default async function AdminPaymentsPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const [{ data: events }, { data: campaigns }] = await Promise.all([
    admin
      .from("payment_events")
      .select("provider, event_id, event_type, campaign_id, payload, received_at")
      .eq("processed", false)
      .order("received_at", { ascending: false })
      .limit(50),
    // Only campaigns that could plausibly be the answer: awaiting payment.
    admin
      .from("campaigns")
      .select("id, title_snapshot, price_usd, days, buyer_name")
      .eq("plan", "sponsored")
      .is("paid_at", null)
      .in("status", ["pending_review", "approved"])
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const rows = (events as EventRow[] | null) ?? [];
  const options = (campaigns as CampaignOption[] | null) ?? [];

  return (
    <PageShell width="narrow">
      <SectionHeading
        level={1}
        title="Payments"
        subtitle="Events the webhook recorded but could not act on. This should normally be empty."
      />

      {rows.length ? (
        <ul className="mt-6 grid list-none gap-4 p-0">
          {rows.map((e) => (
            <li key={`${e.provider}:${e.event_id}`} className="rounded-card border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{e.event_type ?? "unknown event"}</span>
                <span className="numeral text-xs text-fg-2" dir="ltr">
                  {e.provider} · {e.event_id}
                </span>
              </div>
              <p className="m-0 mt-1 text-xs text-fg-2">
                Received {new Date(e.received_at).toLocaleString("en-IL")}
              </p>

              {/*
                The payload verbatim. Matching a stray payment means reading
                whatever the provider actually sent — an email, an order id, a
                half-filled custom field — so it is shown rather than
                summarised into something that might omit the one useful line.
              */}
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-fg-2">Payload</summary>
                <pre className="numeral mt-2 overflow-x-auto rounded-control bg-surface-2 p-3 text-xs" dir="ltr">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              </details>

              <div className="mt-3">
                <AttachPayment
                  provider={e.provider}
                  eventId={e.event_id}
                  campaigns={options.map((c) => ({
                    id: c.id,
                    label: `${c.title_snapshot ?? "Untitled"} — ${c.buyer_name ?? ""} — $${c.price_usd} / ${c.days}d`,
                    priceUsd: Number(c.price_usd),
                  }))}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nothing waiting">
          <p className="m-0">
            Every payment the webhook received has been matched to a listing and acted on.
          </p>
        </EmptyState>
      )}
    </PageShell>
  );
}
