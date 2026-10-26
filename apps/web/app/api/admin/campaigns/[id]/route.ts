import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createReadClient, createAdminClient, supabaseConfigured } from "@/lib/supabase";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin actions on one campaign.
 *
 * ## The check here is the real one
 *
 * `requireAdmin()` on the pages decides what gets rendered. This decides what
 * happens. The two are separate on purpose: a rendered page is a convenience,
 * and anybody can send a POST. The session is read server-side and compared
 * against `ADMIN_EMAILS` before a single row is touched.
 *
 * Every action is a SECURITY DEFINER RPC, so the state machine lives in the
 * database and this route cannot invent a transition the schema disallows.
 */
const ACTIONS = new Set(["approve", "reject", "mark_paid", "refund", "end", "unpublish"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const supabase = await createReadClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // 404, not 403: this endpoint does not confirm its own existence.
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { id } = await params;
  let body: { action?: string; reason?: string; ref?: string; amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const admin = createAdminClient();
  let error: { message: string } | null = null;

  switch (action) {
    case "approve":
      ({ error } = await admin.rpc("approve_campaign", {
        p_campaign_id: id,
        p_admin: user.id,
      }));
      break;

    case "reject":
      ({ error } = await admin.rpc("reject_campaign", {
        p_campaign_id: id,
        p_reason: String(body.reason ?? "").slice(0, 500) || "Did not meet the listing rules.",
        p_admin: user.id,
      }));
      break;

    case "mark_paid":
      /*
       * The manual path, and the one that will carry every sale until the
       * fungies webhook lands. `ref` is the Green Invoice number, which is what
       * makes this traceable to a real document — and the unique constraint on
       * (payment_provider, payment_ref) means entering the same invoice twice
       * cannot double-book a campaign.
       */
      ({ error } = await admin.rpc("mark_campaign_paid", {
        p_campaign_id: id,
        p_provider: "greeninvoice",
        p_ref: String(body.ref ?? "").slice(0, 120),
        p_amount: body.amount ?? null,
        p_currency: "ILS",
      }));
      break;

    case "refund":
      ({ error } = await admin.rpc("refund_campaign", { p_campaign_id: id }));
      break;

    case "end":
      ({ error } = await admin.rpc("end_campaign_now", { p_campaign_id: id }));
      break;

    case "unpublish": {
      /*
       * For a free listing that should not be up.
       *
       * It is `reject_campaign`, which also puts the job back to `draft` — the
       * same mechanism as refusing a paid submission, because the outcome
       * wanted is identical: off the site, with a reason recorded.
       */
      ({ error } = await admin.rpc("reject_campaign", {
        p_campaign_id: id,
        p_reason: String(body.reason ?? "").slice(0, 500) || "Removed after review.",
        p_admin: user.id,
      }));
      break;
    }
  }

  if (error) {
    console.error(`[admin] ${action} failed:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The home strip and search both cache. An approval that is not visible for
  // an hour is an approval the buyer will email about.
  revalidatePath("/");
  revalidatePath("/jobs");

  return NextResponse.json({ ok: true, action });
}
