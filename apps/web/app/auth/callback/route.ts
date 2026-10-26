import { NextResponse } from "next/server";
import { createActionClient } from "@/lib/supabase";
import { CONSENT_A_VERSION } from "@/lib/consent";

/**
 * Accepts either shape Supabase can send.
 *
 * The sign-in UI asks for a six-digit code and verifies it in the browser, so
 * this route normally goes unused. But the outcome depends on the project's
 * email template: the stock template sends `{{ .ConfirmationURL }}`, a link,
 * and only a template containing `{{ .Token }}` produces a code. Handling both
 * means the login works whichever template the project happens to have, rather
 * than breaking silently on a dashboard setting.
 *
 *   ?code=...                    PKCE / OAuth exchange
 *   ?token_hash=...&type=email   magic link and email OTP links
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  const nextParam = url.searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/me";

  const supabase = await createActionClient();
  let failed: string | null = null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) failed = "exchange_failed";
  } else if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: (type as "email" | "magiclink" | "signup" | "recovery") ?? "email",
    });
    if (error) failed = "verify_failed";
  } else {
    failed = "missing_token";
  }

  if (failed) {
    return NextResponse.redirect(new URL(`/auth/login?error=${failed}`, url.origin));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Consent A is recorded once, on first successful sign-in.
    const { data: existing } = await supabase
      .from("consents")
      .select("id")
      .eq("user_id", user.id)
      .eq("type", "A")
      .maybeSingle();

    if (!existing) {
      await supabase.from("consents").insert({
        user_id: user.id,
        type: "A",
        version: CONSENT_A_VERSION,
        text_hash: CONSENT_A_VERSION,
        ua: request.headers.get("user-agent") ?? null,
      });
    }

    await supabase
      .from("profiles")
      .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
