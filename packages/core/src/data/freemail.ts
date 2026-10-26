/**
 * Consumer email providers, used to insist on a work address.
 *
 * ## Why a recruiter must not sign up with Gmail
 *
 * The email domain is how an employer is matched to their `companies` row, and
 * it is the only cheap evidence that the person posting a job for Acme
 * actually works at Acme. `careers@acme.co.il` is checkable; `acme.jobs.2026@
 * gmail.com` is a claim.
 *
 * It is not a security control — anyone determined can buy a domain — and it
 * is not meant to be. It is a speed bump that makes the lazy version of
 * impersonation impossible, and it makes the review queue readable, because
 * the domain column tells the reviewer at a glance who a listing is really from.
 *
 * ## The Israeli half matters
 *
 * A list of the American consumer providers alone would let through walla.co.il
 * and 012.net.il, which are exactly the addresses a small Israeli business
 * actually uses. Those are the ones this list exists for.
 */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // International
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "hotmail.co.il",
  "outlook.com",
  "outlook.co.il",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "tutanota.com",
  "fastmail.com",

  // Israeli consumer ISPs and portals
  "walla.co.il",
  "walla.com",
  "012.net.il",
  "013.net.il",
  "bezeqint.net",
  "netvision.net.il",
  "zahav.net.il",
  "barak.net.il",
  "actcom.net.il",
  "inter.net.il",
  "017.net.il",
  "smile.net.il",
  "hotmail.co.il",
  "nana.co.il",
  "nana10.co.il",

  // Throwaway. Not exhaustive and cannot be; these are the ones seen most.
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "yopmail.com",
  "temp-mail.org",
  "sharklasers.com",
]);

/** True when the address is a consumer or throwaway one, not a work address. */
export function isFreemail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  return FREEMAIL_DOMAINS.has(domain);
}

/** The domain half, lowercased. Mirrors `recruiters.email_domain` in SQL. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const domain = email.trim().toLowerCase().split("@")[1];
  return domain || null;
}
