/**
 * Comma-separated email allowlists, read from the environment.
 *
 * Two places gate on one: `/admin` (`ADMIN_EMAILS`) and the recruiter area
 * (`RECRUIT_ALLOWED_EMAILS`). The logic was written twice, which is one more
 * time than a rule like this should exist — the interesting cases are the
 * empty string, stray whitespace and casing, and getting any of those wrong in
 * one copy and not the other is how a gate quietly stops gating.
 *
 * Deliberately NOT `server-only`, so it can be tested. It holds no secret: the
 * variables have no `NEXT_PUBLIC_` prefix, so they are `undefined` in a browser
 * bundle and every check here fails closed there.
 *
 * ## Empty admits nobody
 *
 * The single most important line in the file. An unset variable is a
 * misconfigured deploy, and a misconfigured deploy should hide the thing it
 * guards, not hand it to everyone. An allowlist that matches all when empty is
 * a lock that opens when you forget the key.
 */

/** Parse a comma-separated list into lowercase, trimmed entries. */
export function parseAllowlist(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether `email` appears in `raw`.
 *
 * Returns false for an empty list and for a missing email — see the header.
 */
export function allowlistAdmits(raw: string | null | undefined, email: string | null | undefined): boolean {
  if (!email) return false;
  const list = parseAllowlist(raw);
  if (!list.length) return false;
  return list.includes(email.trim().toLowerCase());
}
