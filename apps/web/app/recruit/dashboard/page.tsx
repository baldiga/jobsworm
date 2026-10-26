import type { Metadata } from "next";
import Link from "next/link";
import { requireRecruiter } from "@/lib/recruit";
import { createReadClient } from "@/lib/supabase";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ButtonLink } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatUsd } from "@/lib/format";
import DeleteListingButton from "@/components/recruit/DeleteListingButton";
import LogoUploader from "@/components/recruit/LogoUploader";
import { publicLogoUrl } from "@/lib/logo";

export const metadata: Metadata = {
  title: "Your listings",
  robots: { index: false, follow: false },
};

type CampaignTotal = {
  campaign_id: string;
  status: string;
  kind: string;
  plan: string;
  title_snapshot: string | null;
  days: number;
  price_usd: number | string;
  paid_at: string | null;
  days_left: number | null;
  impressions: number;
  card_views: number;
  apply_clicks: number;
};

type SiteDay = { day: string; visits: number; unique_visitors: number; searches: number };

const STATUS_LABEL: Record<string, { text: string; tone: "info" | "warn" | "accent" }> = {
  draft: { text: "Draft", tone: "info" },
  // Kept for rows created before approval became automatic.
  pending_review: { text: "Waiting for review", tone: "warn" },
  approved: { text: "Waiting for payment", tone: "warn" },
  live: { text: "Live", tone: "accent" },
  ended: { text: "Finished", tone: "info" },
  rejected: { text: "Not accepted", tone: "warn" },
  refunded: { text: "Refunded", tone: "warn" },
  cancelled: { text: "Cancelled", tone: "info" },
};

export default async function RecruiterDashboard() {
  const recruiter = await requireRecruiter("/recruit/dashboard");
  const supabase = await createReadClient();

  const [campaignsRes, siteRes] = await Promise.all([
    supabase.rpc("recruiter_campaign_totals"),
    supabase.rpc("recruiter_site_stats", { p_days: 28 }),
  ]);

  /*
   * Cancelled listings are left out.
   *
   * The Delete button cancels rather than destroys — the campaign is a
   * financial record and a live listing has impressions hanging off it — so
   * without this the row would still be sitting there afterwards wearing a
   * "Cancelled" chip, and the button would look broken. Hidden here, still
   * reachable at its own URL.
   */
  const campaigns = ((campaignsRes.data as CampaignTotal[] | null) ?? []).filter(
    (c) => c.status !== "cancelled",
  );
  const site = (siteRes.data as SiteDay[] | null) ?? [];

  const sum = (days: SiteDay[], key: keyof SiteDay) =>
    days.reduce((n, d) => n + Number(d[key] ?? 0), 0);
  const last7 = site.slice(0, 7);

  return (
    <PageShell width="wide">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading level={1} title="Your listings" subtitle={recruiter.org_name} />
        <ButtonLink href="/recruit/new">Post a job</ButtonLink>
      </div>

      {/*
        Set once here, copied onto every listing posted afterwards. It lives on
        the dashboard rather than in the posting form because it belongs to the
        account: somebody posting their fourth role should not be asked for
        their logo a fourth time.
      */}
      <section className="mt-6 rounded-card border border-line bg-surface p-4 sm:p-6">
        <h2 className="mt-0 text-lg">Your logo</h2>
        <p className="m-0 mt-1 mb-4 text-sm text-fg-2">
          Shown on the listings you post, beside the role title. Listings already running keep
          the logo they were posted with.
        </p>
        <LogoUploader currentUrl={publicLogoUrl(recruiter.logo_path)} />
      </section>

      {/* ── Site traffic ─────────────────────────────────────────────────── */}
      {site.length ? (
        <section className="mt-6 rounded-card border border-line bg-surface p-4 sm:p-6">
          <h2 className="mt-0 text-lg">The site</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Visits, last 7 days" value={sum(last7, "visits")} />
            <Stat label="People, last 7 days" value={sum(last7, "unique_visitors")} />
            <Stat label="Searches, last 7 days" value={sum(last7, "searches")} />
            <Stat label="Visits, last 28 days" value={sum(site, "visits")} />
            <Stat label="People, last 28 days" value={sum(site, "unique_visitors")} />
            <Stat label="Searches, last 28 days" value={sum(site, "searches")} />
          </div>
        </section>
      ) : null}

      {/* ── Campaigns ────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-lg">Listings</h2>

        {campaigns.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-fg-2">
                  <th scope="col" className="py-2 pr-4 font-medium">Listing</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Shown</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Opened</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Applied</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Paid</th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const badge = STATUS_LABEL[c.status] ?? { text: c.status, tone: "info" as const };
                  return (
                    <tr key={c.campaign_id} className="border-b border-line last:border-0">
                      <th scope="row" className="py-3 pr-4 font-medium">
                        <Link
                          href={`/recruit/campaigns/${c.campaign_id}`}
                          className="hover:underline"
                        >
                          {c.title_snapshot ?? "Untitled"}
                        </Link>
                        <span className="mt-0.5 block text-xs font-normal text-fg-2">
                          {c.plan === "free" ? "Free · 7 days" : `Sponsored · ${c.days} days`}
                          {c.days_left !== null ? ` · ${c.days_left} left` : ""}
                        </span>
                      </th>
                      <td className="py-3 pr-4">
                        <Chip tone={badge.tone}>{badge.text}</Chip>
                      </td>
                      <td className="numeral py-3 pr-4">
                        {c.plan === "free" ? <span className="text-fg-2">—</span> : c.impressions}
                      </td>
                      <td className="numeral py-3 pr-4">{c.card_views}</td>
                      <td className="numeral py-3 pr-4">{c.apply_clicks}</td>
                      <td className="numeral py-3 pr-4">
                        {c.plan === "free" ? (
                          <span className="text-fg-2">Free</span>
                        ) : (
                          formatUsd(c.price_usd)
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {/*
                          Offered on anything still running, paid or not. A
                          finished listing is the only thing left out, because
                          there is nothing there to take down.

                          `paid` changes the wording rather than hiding the
                          button: a role that has been filled has to be able to
                          come off the site, and the money is explained before
                          the click instead of being a reason to refuse it.
                        */}
                        {!["ended", "refunded", "cancelled"].includes(c.status) ? (
                          <DeleteListingButton
                            campaignId={c.campaign_id}
                            title={c.title_snapshot ?? "Untitled"}
                            paid={Boolean(c.paid_at)}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Nothing posted yet"
            action={<ButtonLink href="/recruit/new">Post your first job</ButtonLink>}
          >
            <p className="m-0">
              Your first seven days are free, and you can see how it performs before deciding
              whether to promote it.
            </p>
          </EmptyState>
        )}
      </section>

      {/*
        The footnote is not boilerplate. It is the definition of every number
        above, and it is the difference between a dashboard somebody trusts and
        one they suspect. "Shown" is blank for free listings because a free
        listing has no sponsored surface to be shown on — saying "0" would read
        as a failure rather than an absence.
      */}
      <p className="mt-8 max-w-[640px] text-xs text-fg-2">
        Updated hourly from our analytics. An impression is counted once per visit, only when your
        card was actually on screen. Visitors who use a tracking blocker are not counted, so the
        true numbers are higher, never lower. Free listings appear in search and on job pages, so
        they have opens and applies but no sponsored impressions.
      </p>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="numeral text-2xl font-bold">{value.toLocaleString("en-IL")}</div>
      <div className="text-xs text-fg-2">{label}</div>
    </div>
  );
}
