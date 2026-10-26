import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRecruiter } from "@/lib/recruit";
import { createReadClient } from "@/lib/supabase";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import CampaignForm, { type CampaignDraft } from "@/components/recruit/CampaignForm";

export const metadata: Metadata = {
  title: "Edit listing",
  robots: { index: false, follow: false },
};

type Row = {
  id: string;
  plan: string;
  status: string;
  days: number;
  title_snapshot: string | null;
};

/**
 * Editing after submission.
 *
 * The form is re-filled from `campaigns.form` — the submission as it was
 * typed — rather than from the decomposed `jobs` row. The job row has been
 * through classification, skill extraction and normalisation; showing a
 * recruiter that back as "what you wrote" would be showing them our
 * interpretation of their words and inviting them to correct it.
 */
export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recruiter = await requireRecruiter(`/recruit/campaigns/${id}/edit`);

  const supabase = await createReadClient();
  const { data: campaigns } = await supabase.rpc("recruiter_my_campaigns");
  const campaign = ((campaigns as Row[] | null) ?? []).find((c) => c.id === id);
  if (!campaign) notFound();
  if (["ended", "refunded", "cancelled", "rejected"].includes(campaign.status)) notFound();

  /*
   * `form` is not returned by `recruiter_my_campaigns` — it is the whole
   * submitted body and has no business on a list page — so it is read here,
   * through the same RLS-free table via a targeted RPC-less select that the
   * session cannot perform. Hence the admin client, with the ownership already
   * established above by the RPC that filtered on auth.uid().
   */
  const { createAdminClient } = await import("@/lib/supabase");
  const { data: full } = await createAdminClient()
    .from("campaigns")
    .select("form, recruiter_id")
    .eq("id", id)
    .maybeSingle();
  if (!full || full.recruiter_id !== recruiter.user_id) notFound();

  const draft = (full.form ?? {}) as CampaignDraft;

  return (
    <PageShell width="narrow">
      <SectionHeading
        level={1}
        title="Edit the listing"
        subtitle={
          campaign.status === "live"
            ? "Your changes go live straight away. The listing stays up while you edit it."
            : "Change anything you like. Nothing is live yet."
        }
      />
      <CampaignForm
        kind={recruiter.kind}
        orgName={recruiter.org_name}
        campaignId={campaign.id}
        initial={{
          ...draft,
          plan: campaign.plan as "free" | "sponsored",
          days: campaign.days,
        }}
      />
    </PageShell>
  );
}
