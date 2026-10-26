import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Chip } from "@/components/ui/Chip";
import { formatUsd, formatSalary, formatTotalComp } from "@/lib/format";
import { benefitLabel } from "@jobsworm/core";
import CampaignActions from "@/components/admin/CampaignActions";

export const metadata: Metadata = {
  title: "Campaign",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const admin = createAdminClient();
  const { data } = await admin
    .from("campaigns")
    .select(
      "id, kind, plan, status, buyer_name, title_snapshot, job_id, days, price_usd, paid_at, payment_ref, approved_at, rejection_reason, created_at, form, recruiters(org_name, website, contact_email, email_domain, status), jobs(id, title_raw, description_text, salary, total_comp, benefits, location, remote, seniority, function, skills_required, apply_url, apply_method, quality_flags, status)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  /*
   * Through `unknown` deliberately.
   *
   * supabase-js types an embedded relation as an array because it cannot tell
   * a to-one from a to-many without generated types. Both `recruiters` and
   * `jobs` here are to-one foreign keys and arrive as objects at run time, so
   * the inferred type is wrong in a way TypeScript will not let us narrow
   * directly. Generating db types for this page is the proper fix; it is not
   * worth blocking the review queue on.
   */
  const c = data as unknown as {
    id: string;
    kind: string;
    plan: string;
    status: string;
    title_snapshot: string | null;
    buyer_name: string | null;
    job_id: string | null;
    days: number;
    price_usd: number;
    paid_at: string | null;
    payment_ref: string | null;
    rejection_reason: string | null;
    recruiters: {
      org_name: string;
      website: string | null;
      contact_email: string;
      email_domain: string;
      status: string;
    } | null;
    jobs: {
      id: string;
      title_raw: string | null;
      description_text: string | null;
      salary: { min?: number; max?: number } | null;
      total_comp: Record<string, number | string | null> | null;
      benefits: string[] | null;
      location: { city?: string; region?: string; abroad?: boolean } | null;
      remote: string | null;
      seniority: string | null;
      function: string | null;
      skills_required: string[] | null;
      apply_url: string | null;
      apply_method: string | null;
      quality_flags: string[] | null;
      status: string;
    } | null;
  };

  const job = c.jobs;

  return (
    <PageShell width="narrow">
      <SectionHeading
        level={1}
        title={c.title_snapshot ?? "Untitled"}
        subtitle={`${c.recruiters?.org_name ?? c.buyer_name ?? "Unknown"} · ${c.plan === "free" ? "Free, 7 days" : `${c.days} days, ${formatUsd(c.price_usd)}`}`}
      />

      <div className="flex flex-wrap gap-1.5">
        <Chip tone={c.status === "live" ? "accent" : "info"}>{c.status}</Chip>
        {c.kind === "agency" ? <Chip tone="warn">Agency</Chip> : null}
        {c.paid_at ? <Chip tone="accent">Paid {c.payment_ref ?? ""}</Chip> : null}
        {job?.quality_flags?.map((f) => (
          <Chip key={f} tone="warn">
            {f}
          </Chip>
        ))}
      </div>

      {/* ── Who ──────────────────────────────────────────────────────────── */}
      <section className="mt-6 rounded-card border border-line bg-surface p-4">
        <h2 className="mt-0 text-base">Who is posting</h2>
        <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-fg-2">Organisation</dt>
          <dd className="m-0">{c.recruiters?.org_name ?? "—"}</dd>
          <dt className="text-fg-2">Email</dt>
          <dd className="numeral m-0" dir="ltr">
            {c.recruiters?.contact_email ?? "—"}
          </dd>
          <dt className="text-fg-2">Domain</dt>
          <dd className="numeral m-0" dir="ltr">
            {c.recruiters?.email_domain ?? "—"}
          </dd>
          <dt className="text-fg-2">Website</dt>
          <dd className="m-0" dir="ltr">
            {c.recruiters?.website ?? "—"}
          </dd>
          <dt className="text-fg-2">Account</dt>
          <dd className="m-0">{c.recruiters?.status ?? "—"}</dd>
        </dl>
      </section>

      {/* ── The listing ──────────────────────────────────────────────────── */}
      <section className="mt-6 rounded-card border border-line bg-surface p-4">
        <h2 className="mt-0 text-base">The listing</h2>
        <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-fg-2">Salary</dt>
          <dd className="numeral m-0" dir="ltr">
            {formatSalary(job?.salary ?? null) ?? "— (should be impossible)"} per month
          </dd>
          {job?.total_comp ? (
            <>
              <dt className="text-fg-2">Total comp</dt>
              <dd className="numeral m-0" dir="ltr">
                {formatTotalComp(job.total_comp as never)}
              </dd>
            </>
          ) : null}
          <dt className="text-fg-2">Where</dt>
          <dd className="m-0">
            {job?.location?.city ?? "—"} · {job?.remote ?? "—"}
            {job?.location?.abroad ? " · ABROAD" : ""}
          </dd>
          <dt className="text-fg-2">Read as</dt>
          <dd className="m-0">
            {job?.function ?? "—"} · {job?.seniority ?? "no seniority"}
          </dd>
          <dt className="text-fg-2">Apply</dt>
          <dd className="m-0 break-all" dir="ltr">
            {job?.apply_url ?? "—"} ({job?.apply_method ?? "—"})
          </dd>
          <dt className="text-fg-2">Job row</dt>
          <dd className="m-0">
            {job?.status ?? "—"}
            {c.job_id ? (
              <>
                {" · "}
                <Link href={`/jobs/${c.job_id}`} className="underline underline-offset-4">
                  open
                </Link>
              </>
            ) : null}
          </dd>
        </dl>

        {job?.benefits?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {job.benefits.map((b) => (
              <Chip key={b} tone="info">
                {benefitLabel(b)}
              </Chip>
            ))}
          </div>
        ) : null}

        {/*
          The description in full, as text. This is the whole point of the
          review — the structured fields can all be right while the prose is a
          course advert — so it is not truncated and not rendered as markup.
        */}
        <p className="jobprose jobprose--plain jobtext m-0 mt-4 text-sm text-fg-2">
          {job?.description_text ?? "No description."}
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-base">Decide</h2>
        {c.rejection_reason ? (
          <p className="m-0 mb-3 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text">
            Previously rejected: {c.rejection_reason}
          </p>
        ) : null}
        <CampaignActions
          campaignId={c.id}
          status={c.status}
          plan={c.plan}
          priceUsd={Number(c.price_usd)}
          paid={Boolean(c.paid_at)}
        />
      </section>
    </PageShell>
  );
}
