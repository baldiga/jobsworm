/**
 * Post a job on somebody's behalf, from the command line.
 *
 * ## Why this exists when there is a web form
 *
 * The first customer will not sign up. They will email a job description, ask
 * what it costs, and pay an invoice — and the whole recruiter zone is worth
 * nothing if there is no way to serve that person on the day they ask. This
 * is that way: it creates the account, the job, the campaign and the payment
 * record in one command, so a sale can be closed over email before anyone has
 * used the form.
 *
 * It is also the only practical way to test the real state machine end to end
 * without a browser, an invoice and a wait.
 *
 * ## Usage
 *
 *   pnpm post:job --file=data/postings/acme.json --email=hr@acme.co.il \
 *                 --kind=employer --days=14 --approve --paid=GI-1042
 *
 *   pnpm post:job --file=… --email=… --free        # free 7-day listing
 *
 * The JSON file holds the same fields the web form submits:
 *
 *   { "title", "company_name", "city", "remote", "employment_type",
 *     "seniority", "description", "apply_to",
 *     "salary_min", "salary_max",
 *     "tc_min", "tc_max", "tc_period", "benefits": ["equity_rsu", …] }
 *
 * `--approve` and `--paid` are separate flags on purpose, mirroring the two
 * independent conditions in `activate_campaign`: the listing goes live when
 * both have happened, in whichever order they happen.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { FREE_DAYS, PACKAGES, planPriceUsd, pricePerDayUsd } from "@jobsworm/core";
import { buildPostedJobRow } from "@jobsworm/adapters/posting";

loadEnv({ path: ".env.local" });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function client(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) die("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Find the auth user for an address, or make one. */
async function ensureUser(supabase: SupabaseClient, email: string): Promise<string> {
  // listUsers is paged and has no filter; for the handful of recruiters this
  // will ever have, one page is plenty and a search index would be silly.
  const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) return existing.id;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) die(`Could not create the user: ${error?.message}`);
  console.log(`  created auth user ${email}`);
  return data.user.id;
}

async function main() {
  const file = arg("file");
  const email = arg("email");
  if (!file) die("--file=path/to/posting.json is required.");
  if (!email) die("--email=someone@company.com is required.");

  const kind = (arg("kind") ?? "employer") as "employer" | "agency";
  if (kind !== "employer" && kind !== "agency") die("--kind must be employer or agency.");

  const free = flag("free");
  const plan: "free" | "sponsored" = free ? "free" : "sponsored";
  const days = free ? FREE_DAYS : Number(arg("days") ?? 14);
  if (!free && !(PACKAGES as readonly number[]).includes(days)) {
    die(`--days must be one of ${PACKAGES.join(", ")} (or pass --free).`);
  }
  if (free && kind === "agency") {
    die("Agencies cannot post free listings — organic search is agency-free. Buy days instead.");
  }

  const body = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const supabase = client();

  const userId = await ensureUser(supabase, email);
  const orgName = String(body.company_name ?? body.org_name ?? "");
  if (!orgName) die("The posting file needs a company_name.");

  /* ---- recruiter ------------------------------------------------------- */
  let agencyId: string | null = null;
  if (kind === "agency") {
    const { data: agency, error } = await supabase
      .from("agencies")
      .upsert(
        {
          name: orgName,
          slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
          contact_email: email,
          plan: "payg",
          status: "active",
        },
        { onConflict: "slug" },
      )
      .select("id")
      .single();
    if (error || !agency) die(`agencies upsert failed: ${error?.message}`);
    agencyId = agency.id;
    await supabase
      .from("agency_users")
      .upsert(
        { agency_id: agencyId, user_id: userId, role: "owner", email },
        { onConflict: "agency_id,user_id" },
      );
  }

  const { error: recruiterError } = await supabase.from("recruiters").upsert(
    {
      user_id: userId,
      kind,
      agency_id: agencyId,
      org_name: orgName,
      contact_email: email,
      status: "active",
      verified_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (recruiterError) die(`recruiters upsert failed: ${recruiterError.message}`);

  /* ---- the job row ----------------------------------------------------- */
  const campaignId = randomUUID();
  const { row, reject, flags } = buildPostedJobRow({
    campaignId,
    kind,
    plan,
    postedBy: userId,
    recruiterEmail: email,
    title: String(body.title ?? ""),
    companyName: orgName,
    descriptionText: String(body.description ?? ""),
    locationRaw: body.city ? String(body.city) : null,
    applyUrl: String(body.apply_to ?? ""),
    employmentTypeRaw: body.employment_type ? String(body.employment_type) : null,
    salaryMin: (body.salary_min as string) ?? null,
    salaryMax: (body.salary_max as string) ?? null,
    totalCompMin: (body.tc_min as string) ?? null,
    totalCompMax: (body.tc_max as string) ?? null,
    totalCompPeriod: body.tc_period === "month" ? "month" : "year",
    benefits: body.benefits,
  });
  if (reject || !row) die(`The listing was refused: ${reject}`);
  if (body.remote) row.remote = body.remote;
  if (body.seniority) row.seniority = body.seniority;
  if (flags.length) row.quality_flags = flags;

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert(row)
    .select("id")
    .single();
  if (jobError || !job) die(`job insert failed: ${jobError?.message}`);

  /* ---- the campaign ---------------------------------------------------- */
  const price = planPriceUsd(plan, days);
  const { error: campaignError } = await supabase.from("campaigns").insert({
    id: campaignId,
    recruiter_id: userId,
    kind,
    plan,
    buyer_name: orgName,
    job_id: job.id,
    title_snapshot: row.title_raw,
    form: body,
    days,
    price_usd: price,
    price_per_day_usd: plan === "free" ? 0 : pricePerDayUsd(days),
    status: plan === "free" ? "approved" : "pending_review",
    submitted_at: new Date().toISOString(),
    approved_at: plan === "free" ? new Date().toISOString() : null,
  });
  if (campaignError) {
    await supabase.from("jobs").delete().eq("id", job.id);
    die(`campaign insert failed: ${campaignError.message}`);
  }

  /* ---- approve / pay / activate ---------------------------------------- */
  if (flag("approve") && plan !== "free") {
    const { error } = await supabase.rpc("approve_campaign", { p_campaign_id: campaignId });
    if (error) die(`approve_campaign failed: ${error.message}`);
    console.log("  approved");
  }

  const paidRef = arg("paid");
  if (paidRef) {
    const amount = arg("amount") ? Number(arg("amount")) : price;
    const { error } = await supabase.rpc("mark_campaign_paid", {
      p_campaign_id: campaignId,
      p_provider: "greeninvoice",
      p_ref: paidRef,
      p_amount: amount,
      p_currency: "ILS",
    });
    if (error) die(`mark_campaign_paid failed: ${error.message}`);
    console.log(`  marked paid: ${paidRef} (₪${amount})`);
  }

  if (plan === "free") {
    const { error } = await supabase.rpc("activate_campaign", { p_campaign_id: campaignId });
    if (error) die(`activate_campaign failed: ${error.message}`);
  }

  const { data: final } = await supabase
    .from("campaigns")
    .select("status, ends_at")
    .eq("id", campaignId)
    .single();

  // `||`, not `??`: an env var set to the empty string is the common case in CI and
  // in a half-filled .env, and `??` passes it straight through. See the comment at
  // the top of apps/web/lib/site.ts, which is where this fallback is defined properly.
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://www.jobsworm.fun";
  console.log("");
  console.log(`  campaign ${campaignId}`);
  console.log(`  status   ${final?.status}`);
  console.log(`  plan     ${plan === "free" ? `free, ${FREE_DAYS} days` : `${days} days, ₪${price}`}`);
  if (flags.length) console.log(`  flags    ${flags.join(", ")}`);
  console.log(`  ends     ${final?.ends_at ?? "not live yet"}`);
  console.log(`  url      ${site}/jobs/${job.id}`);
  console.log("");
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
