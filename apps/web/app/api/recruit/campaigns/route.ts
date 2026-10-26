import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient, supabaseConfigured } from "@/lib/supabase";
import { getRecruiter } from "@/lib/recruit";
import { prepareCampaign, rejectionMessage, type CampaignBody } from "@/lib/campaign-write";
import { payUrlFor } from "@/lib/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creating a listing.
 *
 * ## Two outcomes, decided by the plan
 *
 * A FREE listing goes live here, in this request. Its admissions test is the
 * automated one in `buildPostedJobRow`, it has already passed, and there is
 * nothing to pay — so making somebody wait for a human would be theatre. It
 * closes itself after seven days.
 *
 * A PAID listing is created `approved` and goes live the moment payment
 * lands. See the note on the insert below for why there is no human step.
 *
 * ## The quota
 *
 * Free listings are capped per account. Instant unreviewed publishing is the
 * cheapest way to run a fake-vacancy CV harvest, and the cap is what stops one
 * account doing it at volume before anybody looks. Checked here rather than in
 * a constraint because it needs to produce a sentence, not a violation.
 */
export async function POST(request: Request) {
  /*
   * The allowlist gate is gone — anyone may be a recruiter now. What stands in
   * its place is `getRecruiter()` below, which returns null both for a signed
   * out visitor and for somebody who has not registered, and answers 403 with
   * the next step rather than a 404 that says nothing.
   */
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const recruiter = await getRecruiter();
  if (!recruiter) {
    return NextResponse.json({ error: "Set up a recruiter account first." }, { status: 403 });
  }
  if (recruiter.status === "blocked") {
    return NextResponse.json({ error: "This account cannot post listings." }, { status: 403 });
  }

  let body: CampaignBody;
  try {
    body = (await request.json()) as CampaignBody;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const prepared = prepareCampaign(recruiter, body);
  if (!prepared.ok) {
    return NextResponse.json({ error: rejectionMessage(prepared.reject) }, { status: 422 });
  }

  const admin = createAdminClient();

  if (prepared.plan === "free") {
    const { data: quota } = await admin.rpc("recruiter_free_quota_for", {
      p_user: recruiter.user_id,
    });
    const q = (quota ?? {}) as Record<string, number>;
    if ((q.live_used ?? 0) >= (q.live_limit ?? 4)) {
      return NextResponse.json(
        {
          error: `You already have ${q.live_used} free listings running. Close one, or promote this listing to publish it alongside them.`,
        },
        { status: 429 },
      );
    }
    if ((q.week_used ?? 0) >= (q.week_limit ?? 8)) {
      return NextResponse.json(
        {
          error:
            "That is a lot of free listings in one week. Get in touch and we will sort out something that fits.",
        },
        { status: 429 },
      );
    }
  }

  /*
   * Job first, then campaign.
   *
   * `campaigns.job_id` references `jobs`, so the job has to exist. The job is
   * written as a `draft`, which is invisible to every read path on the site,
   * so a failure between the two statements leaves an orphan nobody can see
   * rather than a live listing nobody paid for.
   */
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert(prepared.row)
    .select("id")
    .single();
  if (jobError || !job) {
    console.error("[recruit] job insert failed:", jobError?.message);
    return NextResponse.json({ error: "Could not save the listing." }, { status: 500 });
  }

  const { error: campaignError } = await admin.from("campaigns").insert({
    id: prepared.campaignId,
    recruiter_id: recruiter.user_id,
    kind: recruiter.kind,
    plan: prepared.plan,
    buyer_name: recruiter.org_name,
    job_id: job.id,
    title_snapshot: prepared.row.title_raw,
    form: prepared.form,
    days: prepared.days,
    price_usd: prepared.priceUsd,
    price_per_day_usd: prepared.perDayUsd,
    /*
     * Approved on submission, both plans. There is no human review step.
     *
     * The admissions test is the automated one in `buildPostedJobRow`, and it
     * has already passed by the time this row is written: real tech role, in
     * Israel, a salary inside plausible bounds, an apply route that resolves,
     * and an agency cannot take the free tier. A person adds nothing to that
     * at the moment of submission — and a queue that has to be watched before
     * anybody can pay is a queue that loses sales while it is not being
     * watched. Which is exactly what happened: a listing was built, paid for
     * in intent, and sat at `pending_review` with no way to pay.
     *
     * Review moves to AFTER the fact. Everything still lands in the admin
     * queue, flagged where the gates were unsure, and can be taken down — the
     * difference is that taking something down is a decision made against a
     * live listing rather than a decision everybody waits on.
     *
     * `approved_by` stays null: it records WHO approved, and nobody did.
     */
    status: "approved",
    submitted_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
  });
  if (campaignError) {
    console.error("[recruit] campaign insert failed:", campaignError.message);
    // Leave no orphan draft behind.
    await admin.from("jobs").delete().eq("id", job.id);
    return NextResponse.json({ error: "Could not save the listing." }, { status: 500 });
  }

  if (prepared.flags.length) {
    await admin
      .from("jobs")
      .update({ quality_flags: prepared.flags })
      .eq("id", job.id);
  }

  /*
   * The account goes active on its first accepted listing.
   *
   * `recruiter_site_stats` requires an ACTIVE recruiter, and nothing was ever
   * flipping the flag now that approval is automatic — so a recruiter would
   * have posted a listing and then found their own dashboard empty of the
   * traffic figures the pitch page promised them.
   */
  if (recruiter.status === "pending") {
    await admin
      .from("recruiters")
      .update({ status: "active", verified_at: new Date().toISOString() })
      .eq("user_id", recruiter.user_id);
  }

  let live = false;
  if (prepared.plan === "free") {
    const { error: activateError } = await admin.rpc("activate_campaign", {
      p_campaign_id: prepared.campaignId,
    });
    if (activateError) {
      console.error("[recruit] activate failed:", activateError.message);
    } else {
      live = true;
      revalidatePath("/jobs");
    }
  }

  /*
   * A paid listing goes STRAIGHT to checkout.
   *
   * The old flow returned the campaign id and let the form navigate to the
   * campaign page, where a Pay button rendered only for status `approved` —
   * which a new sponsored campaign was not. So somebody who had just built a
   * listing and chosen to promote it landed on a page with no way to pay, and
   * reasonably concluded the site had merely saved a draft. It had.
   *
   * Null when the hosted-checkout URLs are not configured. The form then falls
   * back to the campaign page, which explains that an invoice is coming — the
   * links only exist in the fungies dashboard and no API mints one, so there
   * is genuinely nowhere to send anybody until they are copied in.
   */
  const checkoutUrl = prepared.plan === "sponsored" ? payUrlFor(prepared.campaignId) : null;

  return NextResponse.json({
    ok: true,
    campaign_id: prepared.campaignId,
    job_id: job.id,
    plan: prepared.plan,
    live,
    checkout_url: checkoutUrl,
  });
}
