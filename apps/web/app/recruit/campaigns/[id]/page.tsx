import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRecruiter } from "@/lib/recruit";
import { createReadClient } from "@/lib/supabase";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ButtonLink } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { formatUsd } from "@/lib/format";
import CloseListingButton from "@/components/recruit/CloseListingButton";
import PayButton from "@/components/recruit/PayButton";
import PaymentConfirming from "@/components/recruit/PaymentConfirming";

export const metadata: Metadata = {
  title: "Listing",
  robots: { index: false, follow: false },
};

type Row = {
  id: string;
  kind: string;
  plan: string;
  status: string;
  title_snapshot: string | null;
  job_id: string | null;
  days: number;
  price_usd: number | string;
  paid_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  days_left: number | null;
  rejection_reason: string | null;
  created_at: string;
};

type Day = {
  day: string;
  impressions_home: number;
  impressions_search: number;
  card_views: number;
  apply_clicks: number;
};

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { id } = await params;
  const { paid: justPaid } = await searchParams;
  await requireRecruiter(`/recruit/campaigns/${id}`);

  const supabase = await createReadClient();
  const [{ data: campaigns }, { data: daysData }] = await Promise.all([
    supabase.rpc("recruiter_my_campaigns"),
    supabase.rpc("recruiter_campaign_stats", { p_campaign_id: id }),
  ]);

  // Both RPCs filter on auth.uid(), so "not mine" and "does not exist" arrive
  // here as the same empty result — and leave as the same 404.
  const campaign = ((campaigns as Row[] | null) ?? []).find((c) => c.id === id);
  if (!campaign) notFound();

  const days = (daysData as Day[] | null) ?? [];
  const total = (key: keyof Day) => days.reduce((n, d) => n + Number(d[key] ?? 0), 0);
  const isFree = campaign.plan === "free";
  const editable = !["ended", "refunded", "cancelled", "rejected"].includes(campaign.status);

  return (
    <PageShell width="narrow">
      {/*
        A way back, because there was none. This page is reached from the
        dashboard, from the post-payment redirect and from an emailed link, and
        the only exit was the browser's back button — which after paying goes
        to the payment page. An explicit link is the one route out that is
        correct from all three.
      */}
      <Link
        href="/recruit/dashboard"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-fg-2 hover:text-fg"
      >
        <span aria-hidden="true">&larr;</span> All your listings
      </Link>

      <SectionHeading
        level={1}
        title={campaign.title_snapshot ?? "Listing"}
        subtitle={
          isFree
            ? "Free listing · 7 days"
            : `Sponsored · ${campaign.days} days · ${formatUsd(campaign.price_usd)}`
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={campaign.status === "live" ? "accent" : "info"}>{campaign.status}</Chip>
        {campaign.days_left !== null ? (
          <Chip tone="warn">{campaign.days_left} days left</Chip>
        ) : null}
        {campaign.job_id && campaign.status === "live" ? (
          <Link href={`/jobs/${campaign.job_id}`} className="text-sm underline underline-offset-4">
            See it as a job seeker does
          </Link>
        ) : null}
      </div>

      {campaign.status === "rejected" && campaign.rejection_reason ? (
        <p className="mt-4 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text">
          <strong className="font-semibold">Not accepted.</strong> {campaign.rejection_reason}
        </p>
      ) : null}

      {/*
        Somebody who has just come back from the payment window sees that we
        know about it, not a Pay button for something they have already paid
        for. `?paid=1` is the browser's word, not proof — see PaymentConfirming
        — so it changes what the page SAYS and nothing about what it does.
      */}
      {!campaign.paid_at && justPaid === "1" ? <PaymentConfirming /> : null}

      {campaign.status === "approved" && !campaign.paid_at && justPaid !== "1" ? (
        <div className="mt-4 grid gap-3 rounded-card border border-line bg-surface p-4">
          <p className="m-0 text-sm">
            <strong className="font-semibold">Approved.</strong> It goes live as soon as it is
            paid for.
          </p>
          <PayButton campaignId={campaign.id} priceLabel={formatUsd(campaign.price_usd) ?? ""} />
        </div>
      ) : null}

      {/* ── Numbers ──────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-lg">How it is doing</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {!isFree ? (
            <Stat label="Shown" value={total("impressions_home") + total("impressions_search")} />
          ) : null}
          <Stat label="Opened" value={total("card_views")} />
          <Stat label="Apply clicks" value={total("apply_clicks")} />
          {!isFree && total("card_views") > 0 ? (
            <Stat
              label="Click-through"
              value={Math.round((total("apply_clicks") / total("card_views")) * 100)}
              suffix="%"
            />
          ) : null}
        </div>

        {days.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-fg-2">
                  <th scope="col" className="py-2 pr-4 font-medium">Day</th>
                  {!isFree ? (
                    <>
                      <th scope="col" className="py-2 pr-4 font-medium">Home</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Search</th>
                    </>
                  ) : null}
                  <th scope="col" className="py-2 pr-4 font-medium">Opened</th>
                  <th scope="col" className="py-2 font-medium">Applied</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day} className="border-b border-line last:border-0">
                    <th scope="row" className="numeral py-2 pr-4 font-normal">{d.day}</th>
                    {!isFree ? (
                      <>
                        <td className="numeral py-2 pr-4">{d.impressions_home}</td>
                        <td className="numeral py-2 pr-4">{d.impressions_search}</td>
                      </>
                    ) : null}
                    <td className="numeral py-2 pr-4">{d.card_views}</td>
                    <td className="numeral py-2">{d.apply_clicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m-0 mt-3 text-sm text-fg-2">
            No numbers yet. They are collected hourly and start once the listing is live.
          </p>
        )}
      </section>

      <div className="mt-8 flex flex-wrap gap-3 border-t border-line pt-6">
        {editable ? (
          <ButtonLink href={`/recruit/campaigns/${campaign.id}/edit`} variant="ghost">
            Edit the listing
          </ButtonLink>
        ) : null}
        {/*
          Paid listings included. The commonest reason to be on this page is
          that the role was filled, and refusing to take a paid ad down is the
          one thing a site against ghost jobs must not do.
        */}
        {editable ? (
          <CloseListingButton campaignId={campaign.id} paid={Boolean(campaign.paid_at)} />
        ) : null}
      </div>

      {campaign.paid_at && editable ? (
        <p className="m-0 mt-3 text-xs text-fg-2">
          Editing a live listing keeps it live — we do not take down something you paid for over a
          correction. Substantial changes are flagged for us to read.
        </p>
      ) : null}
    </PageShell>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div>
      <div className="numeral text-2xl font-bold">
        {value.toLocaleString("en-IL")}
        {suffix ?? ""}
      </div>
      <div className="text-xs text-fg-2">{label}</div>
    </div>
  );
}
