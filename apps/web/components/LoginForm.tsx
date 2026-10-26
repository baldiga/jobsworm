"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { CONSENT_A_TEXT_EN, CONSENT_A_VERSION, consentTextHash } from "@/lib/consent";

/**
 * Email plus a six-digit code. No passwords at all.
 *
 * A password is a thing to choose, store, forget and reset, and it buys nothing
 * here: the email round-trip is the actual proof of identity either way. A code
 * typed into the page also survives the mail clients that rewrite or pre-fetch
 * links, which is what breaks magic links in practice.
 */

const CODE_LENGTH = 6;

/*
 * Must be >= the project's `auth.email.max_frequency`, which is 1m0s.
 *
 * This was 45s, so the button re-enabled fifteen seconds before the server
 * would accept another send. Anyone who did the obvious thing — wait for the
 * timer, press "Send a new code" — got an error instead of an email, which
 * reads as "the site never sent me anything".
 */
const RESEND_SECONDS = 60;

/*
 * The cooldown has to survive a page load, or it is not a cooldown.
 *
 * It lived only in React state, so reloading the page — or being bounced to
 * it by a sign-in link, which is how it happened — set it back to zero. The
 * button came back immediately, the server answered 429 ("only request this
 * after 10 seconds"), and the person saw a sign-in form that had apparently
 * stopped working. Reproduced from the auth logs of a user on 2026-09-16 who
 * sent a code at 13:01:01 and was refused at 13:01:50 and 13:01:56.
 *
 * Keyed by email address, because the server's limit is per address. A
 * different address is a different limit and should not wait.
 *
 * Private windows and some embedded browsers throw on storage access, so both
 * reads and writes are guarded; without storage we fall back to exactly the old
 * behaviour, which is imperfect but not broken.
 */
const SENT_KEY = "jw:otp-sent";

function rememberSent(address: string) {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify({ e: address.toLowerCase(), t: Date.now() }));
  } catch {
    /* storage unavailable: the in-memory cooldown still applies */
  }
}

/** Seconds left before `address` may be sent another code, per our last send. */
function secondsUntilResend(address: string): number {
  try {
    const raw = localStorage.getItem(SENT_KEY);
    if (!raw) return 0;
    const { e, t } = JSON.parse(raw) as { e?: string; t?: number };
    if (!e || !t || e !== address.toLowerCase()) return 0;
    const left = RESEND_SECONDS - Math.floor((Date.now() - t) / 1000);
    return left > 0 ? left : 0;
  } catch {
    return 0;
  }
}

function client() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/me";

  /*
   * /auth/callback redirects here with ?error=... when a sign-in LINK fails,
   * and nothing read it — so clicking an expired link dropped you back on a
   * blank login form with no clue what happened. To a person who just clicked
   * the thing we emailed them, a form that silently resets IS the site being
   * broken. Say what went wrong and what to do about it.
   */
  const linkError = params.get("error");

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    linkError === "verify_failed"
      ? "That sign-in link has already been used or has expired. Enter your email for a fresh code."
      : linkError === "exchange_failed"
        ? "That sign-in link could not be completed. Enter your email for a fresh code."
        : linkError
          ? "That sign-in link was incomplete. Enter your email for a fresh code."
          : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function sendCode(resend = false) {
    setError(null);
    setNotice(null);

    if (!email.trim()) return setError("Enter an email address");
    if (!agreed) return setError("Please accept the privacy notice to continue");

    /*
     * A code went to this address under a minute ago — say so instead of
     * asking the server and getting a 429. Move to the code step too: the
     * person who reloaded mid-sign-in has a code on its way and needs the box
     * to type it into, not a second email that would cancel the first.
     */
    const wait = secondsUntilResend(email.trim());
    if (wait > 0) {
      setStep("code");
      setCooldown(wait);
      setNotice(
        `We already sent a code to ${email.trim()} a moment ago. It can take a minute to arrive — check your inbox and spam folder.`,
      );
      return;
    }

    setBusy(true);
    try {
      const supabase = client();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          /*
           * Whether the email carries a six-digit code or a link is decided by
           * the project's email TEMPLATE, not by anything sent from here: a
           * template using {{ .Token }} produces a code, one using
           * {{ .ConfirmationURL }} produces a link. This app has to work with
           * either, because getting it wrong locks everyone out.
           *
           * So emailRedirectTo is always set. Without it the link falls back to
           * the project's Site URL — which points at localhost in a
           * dev-configured project — and clicking it from a real inbox lands on
           * a dead address. With it, the link resolves to our callback, which
           * already handles both the PKCE `code` and the `token_hash` shapes.
           */
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          shouldCreateUser: true,
          data: { consent_a: CONSENT_A_VERSION },
        },
      });
      if (error) throw error;

      rememberSent(email.trim());
      setCode("");
      setStep("code");
      setCooldown(RESEND_SECONDS);
      setNotice(
        /*
         * "New code sent." left out the one fact that decides whether the next
         * attempt works: every new code cancels the one before it, and email
         * is slower than a button. So the code already sitting in the inbox —
         * the one the person will naturally type — is now dead, while the live
         * one is still in transit.
         */
        resend
          ? "New code sent. Your earlier codes no longer work — wait for the newest email and use that code."
          : `We sent a ${CODE_LENGTH}-digit code to ${email.trim()}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      /*
       * Never show a transport error verbatim. A visitor was shown the string
       * "HTTP 504" where an explanation belonged — a gateway timeout is a fact
       * about our infrastructure, not something they can act on, and it reads
       * as gibberish. Anything that is not a real, actionable auth error gets
       * plain English and an invitation to retry.
       */
      const transport =
        /(50\d|429|408)|timeout|timed out|gateway|network|fetch failed|load failed/i.test(
          message,
        );
      setError(
        /*
         * "Error sending confirmation email" reached the screen verbatim —
         * found while testing this form on 2026-09-16. It is what Supabase says
         * when the mail provider refuses, and the provider is on a daily and
         * monthly cap that signups have exceeded before. The person can do
         * nothing about it except not give up, so tell them that.
         */
        /error sending|could not send|smtp|mail(er)? (error|failure)/i.test(message)
          ? "We couldn't send the email just now. Please try again in a few minutes."
          : /after \d+ seconds?|for security purposes/i.test(message)
          ? "Codes can only be sent once a minute. Wait a moment and try again."
          : /rate limit|too many/i.test(message)
            ? "Too many codes requested. Try again in a few minutes."
            : /invalid/i.test(message)
              ? "That email address is not valid"
              : transport
                ? "We could not reach the sign-in service just now. Please try again in a moment."
                : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const digits = code.replace(/\D/g, "");
    if (digits.length !== CODE_LENGTH) return setError(`The code is ${CODE_LENGTH} digits`);

    setBusy(true);
    try {
      const supabase = client();

      /*
       * One verify call, type "email".
       *
       * An earlier version of this tried "email" and then fell back to
       * "signup", on the theory that a first-ever code from a project with
       * "Confirm email" enabled needed the signup type. That theory was wrong.
       * Tested against this project with admin generate_link, minting a fresh
       * token for a brand-new user: type "email" and type "signup" BOTH return
       * 200 and issue a session. The fallback never fired, so it has been
       * removed rather than left in as decoration.
       */
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: digits,
        type: "email",
      });
      if (error) throw error;

      // Consent is recorded once, after the identity is actually proven.
      try {
        await supabase.rpc("record_consent", {
          p_type: "A",
          p_version: CONSENT_A_VERSION,
          p_text_hash: await consentTextHash(),
        });
      } catch {
        // A failed consent write must not strand a signed-in user; /me retries.
      }

      router.push(next);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      const transport =
        /(50\d|429|408)|timeout|timed out|gateway|network|fetch failed|load failed/i.test(
          message,
        );
      setError(
        /*
         * "That code expired. Request a new one." was the trap itself.
         *
         * Supabase answers "Token has expired or is invalid" for a mistyped
         * code, a code from an earlier email, and a genuinely old one alike. By
         * far the commonest of those is the earlier email — the person pressed
         * resend, and the inbox still shows the previous code. Telling them to
         * request another cancels the code that is about to arrive, so they
         * type the next visible one, which is also dead, and get told the same
         * thing again. One user went round that loop seven times in two and a
         * half minutes on 2026-09-16 and never got in.
         *
         * So name the likely cause and send them to the inbox, not the button.
         *
         * No expiry duration in the copy. The repo's config.toml says 3600s,
         * but that file is the LOCAL config (its site_url is 127.0.0.1), and a
         * number shown to a person should be the live one or nothing.
         */
        /expired|invalid/i.test(message)
          ? "That code didn't work. If you asked for more than one code, only the newest email's code is valid — check you're using that one."
          : /incorrect/i.test(message)
            ? "That code is not correct. Check and try again."
            : transport
              ? "We could not reach the sign-in service just now. Your code is still valid — try again in a moment."
              : message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      {step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email address
            </label>
            <input
              id="email"
              type="email"
              dir="ltr"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-control border border-line-strong bg-surface px-3 py-2.5 text-start focus:border-action"
            />
            <p className="m-0 mt-1.5 text-xs text-fg-2">
              We will email you a one-time code. There is no password.
            </p>
          </div>

          <div className="rounded-control bg-surface-2 p-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-action)]"
              />
              <span>
                I have read and accept the{" "}
                <button
                  type="button"
                  onClick={() => setShowConsent((v) => !v)}
                  className="text-action-text underline underline-offset-2"
                >
                  privacy notice
                </button>
              </span>
            </label>
            {showConsent ? (
              <p className="m-0 mt-3 whitespace-pre-line border-t border-line pt-3 text-[13px] leading-relaxed text-fg-2">
                {CONSENT_A_TEXT_EN}
              </p>
            ) : null}
          </div>

          <Messages error={error} notice={notice} />

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-control bg-action px-4 py-3 font-medium text-on-action transition-colors hover:bg-action-hover disabled:opacity-60"
          >
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          {/*
            The email leads with a {{ .Token }} code and carries the link as a
            fallback, so both routes work. CODE_LENGTH must stay in step with
            the project's `mailer_otp_length`: it was 8 server-side while this
            form demanded 6, which would have rejected every valid code.
          */}
          <div className="rounded-control border border-line bg-surface-2 p-3 text-sm">
            <p className="m-0 font-medium">Check your email</p>
            <p className="m-0 mt-1 text-fg-2">
              Enter the {CODE_LENGTH}-digit code below, or click the sign-in link in the
              email instead.
            </p>
          </div>

          <div>
            <label htmlFor="code" className="mb-1.5 block text-sm font-medium">
              Your {CODE_LENGTH}-digit code
            </label>
            <input
              id="code"
              ref={codeRef}
              type="text"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
              placeholder="123456"
              className="w-full rounded-control border border-line-strong bg-surface px-3 py-2.5 text-center font-[family-name:var(--font-display)] text-2xl tracking-[0.4em] focus:border-action"
            />
          </div>

          <Messages error={error} notice={notice} />

          <button
            type="submit"
            disabled={busy || code.length !== CODE_LENGTH}
            className="w-full rounded-control bg-action px-4 py-3 font-medium text-on-action transition-colors hover:bg-action-hover disabled:opacity-60"
          >
            {busy ? "Checking…" : "Sign in"}
          </button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
                setNotice(null);
              }}
              className="text-fg-2 underline underline-offset-2"
            >
              Change email
            </button>
            <button
              type="button"
              disabled={cooldown > 0 || busy}
              onClick={() => void sendCode(true)}
              className="text-action-text underline underline-offset-2 disabled:text-fg-2 disabled:no-underline"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Send a new code"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Messages({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? (
        <p role="alert" className="m-0 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="m-0 rounded-control bg-info-tint px-3 py-2 text-sm text-info-text">{notice}</p>
      ) : null}
    </>
  );
}
