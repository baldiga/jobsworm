import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createReadClient, supabaseConfigured } from "@/lib/supabase";
import { getRecruiter } from "@/lib/recruit";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import RecruiterStartForm from "@/components/recruit/RecruiterStartForm";

export const metadata: Metadata = {
  title: "Set up your recruiter account",
  robots: { index: false, follow: false },
};

export default async function RecruitStartPage() {
  // Signup is the one page a non-recruiter is supposed to reach —
  // `requireRecruiter()` would send them here, so it cannot guard it.
  if (!supabaseConfigured) redirect("/recruit");

  const supabase = await createReadClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=%2Frecruit%2Fstart");

  // Already registered: nothing to do here, and re-registering would be a way
  // to change `kind` without anyone reviewing it.
  const existing = await getRecruiter();
  if (existing) redirect("/recruit/dashboard");

  return (
    <PageShell width="prose">
      <SectionHeading
        level={1}
        title="Set up your recruiter account"
        subtitle="Two questions, and you can post straight afterwards. Checks happen automatically, in the moment — you are not waiting on anybody."
      />
      {/*
        Said plainly, because the rest of this site is a job-seeker product and
        somebody arriving here has just been asked for an email address by
        something that elsewhere wants a CV. A recruiter account has no CV, no
        skills, no search preferences and no matching — it is a different thing
        that happens to share a login.
      */}
      <p className="m-0 mt-4 text-sm text-fg-2">
        A recruiter account is separate from a job-seeker profile. We do not ask you for a CV,
        skills or search preferences, and nothing here is matched against jobs.
      </p>
      <RecruiterStartForm email={user.email ?? ""} />
    </PageShell>
  );
}
