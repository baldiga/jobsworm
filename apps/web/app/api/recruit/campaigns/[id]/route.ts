import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient, supabaseConfigured } from "@/lib/supabase";
import { getRecruiter } from "@/lib/recruit";
import { prepareCampaign, rejectionMessage, type CampaignBody } from "@/lib/campaign-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Editing a listing after it has been submitted.
 *
 * ## A live listing stays live while it is edited
 *
 * The tempting rule is "any edit sends it back for review". It is also the
 * wrong one. A recruiter who spots a typo an hour after paying $80 would have
 * their listing taken down for fixing it, which teaches them not to fix it —
 * so the index ends up holding the typo, and the buyer resents the purchase.
 *
 * Instead the change is applied immediately, and a live PAID listing is
 * flagged `edited_after_approval` for the review queue. An admin sees what
 * changed and can act; nobody is punished for correcting their own copy.
 *
 * The edit still runs the FULL gate. Everything the create path refuses, this
 * refuses: non-tech, abroad, no salary, an off-domain apply address on a free
 * listing. An edit that would not have been accepted as a submission is not
 * accepted as an edit, which is the hole this shape could otherwise open.
 *
 * ## What cannot be changed here
 *
 * The plan and the length. Turning a paid campaign into a free one after the
 * fact, or a 7-day one into 28 days, is a change to what was bought — money,
 * not copy. Those go through checkout or through a person.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // The allowlist gate is gone — anyone may be a recruiter. `getRecruiter()`
  // below is what stands between a stranger and somebody else's listing, and
  // the RPCs it feeds are all scoped by `auth.uid()`.
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const { id } = await params;
  const recruiter = await getRecruiter();
  if (!recruiter) return NextResponse.json({ error: "not a recruiter" }, { status: 403 });

  const admin = createAdminClient();

  /*
   * Ownership, checked against the row. A campaign belonging to somebody else
   * gives the same 404 as one that does not exist — the existence of another
   * recruiter's campaign id is not something this endpoint confirms.
   */
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, recruiter_id, kind, plan, days, status, job_id")
    .eq("id", id)
    .maybeSingle();
  if (!campaign || campaign.recruiter_id !== recruiter.user_id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (["ended", "refunded", "cancelled", "rejected"].includes(campaign.status)) {
    return NextResponse.json(
      { error: "This listing has finished. Post it again to run it for another period." },
      { status: 409 },
    );
  }

  let body: CampaignBody;
  try {
    body = (await request.json()) as CampaignBody;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // The plan and length come from the stored campaign, never from the body.
  const prepared = prepareCampaign(
    recruiter,
    { ...body, plan: campaign.plan as "free" | "sponsored", days: campaign.days },
    campaign.id,
  );
  if (!prepared.ok) {
    return NextResponse.json({ error: rejectionMessage(prepared.reject) }, { status: 422 });
  }

  const wasLive = campaign.status === "live";
  const flags = [...prepared.flags];
  if (wasLive && campaign.plan === "sponsored") flags.push("edited_after_approval");

  /*
   * `status` is not in the update.
   *
   * A live listing must stay open, and a draft must stay a draft — the row
   * builder always produces `status: 'draft'`, so writing it would take a paid
   * live listing off the site the moment its owner fixed a typo. Same for
   * `expires_at`, which belongs to the campaign's clock and not to this edit.
   */
  const editable = { ...prepared.row };
  delete editable.status;
  delete editable.expires_at;
  delete editable.posted_at;

  const { error: jobError } = await admin
    .from("jobs")
    .update({ ...editable, quality_flags: flags, last_seen_at: new Date().toISOString() })
    .eq("id", campaign.job_id);
  if (jobError) {
    console.error("[recruit] job update failed:", jobError.message);
    return NextResponse.json({ error: "Could not save the changes." }, { status: 500 });
  }

  await admin
    .from("campaigns")
    .update({ title_snapshot: prepared.row.title_raw, form: prepared.form })
    .eq("id", campaign.id);

  if (wasLive) {
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${campaign.job_id}`);
    revalidatePath("/");
  }

  return NextResponse.json({
    ok: true,
    campaign_id: campaign.id,
    flagged_for_review: flags.includes("edited_after_approval"),
  });
}

/**
 * Taking a listing down.
 *
 * Paid ones included. This used to refuse them, so that ending a paid campaign
 * went through a person — but the commonest reason to take a listing down is
 * that the role was filled, and a site whose pitch is that it fights ghost
 * jobs cannot be what keeps a filled vacancy up. The paid listings are the
 * prominent ones, which makes them the worst ones to leave running.
 *
 * Money is a separate question and stays one. This ends the listing and makes
 * no refund; unused days are a conversation, and the button says so before it
 * is pressed.
 *
 * `withdraw_my_campaign` decides which ending applies — cancelled for
 * something never paid for, ended for something that ran — because this route
 * cannot see `paid_at` to decide for itself. `campaigns` has RLS on and no
 * policies, so RPCs are the only way in, and the decision belongs next to the
 * row anyway. It runs as the signed-in user, so ownership is `auth.uid()`
 * inside the function.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // No allowlist any more. `withdraw_my_campaign` runs as the signed-in user
  // and matches on `auth.uid()`, so a stranger reaches nothing and somebody
  // else's campaign is indistinguishable from one that does not exist.
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const { id } = await params;

  const { createActionClient } = await import("@/lib/supabase");
  const supabase = await createActionClient();
  const { data: outcome, error } = await supabase.rpc("withdraw_my_campaign", {
    p_campaign_id: id,
  });
  if (error) {
    // The only thing the RPC raises for is a campaign that is not this user's,
    // which is reported as not found rather than echoing a Postgres message.
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  revalidatePath("/jobs");
  revalidatePath("/");
  // The outcome is returned so the page can say which thing happened: a draft
  // that was never public and a paid listing that ran for three days are not
  // the same event, and "cancelled" would be wrong for the second.
  return NextResponse.json({ ok: true, outcome: outcome ?? "ended" });
}
