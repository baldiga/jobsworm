import type { Metadata } from "next";
import { requireRecruiter } from "@/lib/recruit";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import CampaignForm from "@/components/recruit/CampaignForm";

export const metadata: Metadata = {
  title: "Post a job",
  robots: { index: false, follow: false },
};

export default async function NewCampaignPage() {
  const recruiter = await requireRecruiter("/recruit/new");

  return (
    <PageShell width="narrow">
      <SectionHeading
        level={1}
        title="Post a job"
        subtitle={
          recruiter.kind === "agency"
            ? "Your listing will be labelled as an agency listing and will appear in sponsored slots. Choose how long it runs at the bottom."
            : "Free for seven days, or promote it for longer. You choose at the bottom, once you can see what you have written."
        }
      />
      <CampaignForm kind={recruiter.kind} orgName={recruiter.org_name} />
    </PageShell>
  );
}
