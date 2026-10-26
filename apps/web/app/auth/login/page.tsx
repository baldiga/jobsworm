import { Suspense } from "react";
import type { Metadata } from "next";
import LoginForm from "@/components/LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Jobsworm to save jobs, match by CV and track your applications.",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  /*
   * A recruiter arriving here has a different reason to sign in, and telling
   * them about saved jobs and CV matching reads as the wrong door. "Free for
   * job seekers" is also true but beside the point for somebody about to pay.
   */
  const sp = await searchParams;
  const forRecruiters = typeof sp.next === "string" && sp.next.startsWith("/recruit");

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:px-6">
      <div className="mb-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/mascot-256.png"
          alt=""
          width={80}
          height={80}
          className="mx-auto mb-4 h-20 w-auto"
        />
        <h1 className="mb-2 text-[32px]">Sign in to Jobsworm</h1>
        <p className="m-0 text-fg-2">
          {forRecruiters
            ? "Sign in to post and manage your listings."
            : "For saving jobs, CV matching and tracking who replied. Searching itself is open to everyone, no account needed."}
        </p>
        {forRecruiters ? null : (
          <p className="m-0 mt-2 text-sm font-medium">Free for job seekers.</p>
        )}
      </div>

      <Suspense fallback={<div className="h-64 rounded-card bg-surface-2" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
