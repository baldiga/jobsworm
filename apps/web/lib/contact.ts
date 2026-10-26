/**
 * Who runs this deployment, and how to reach them. All of it from the
 * environment, none of it in the source.
 *
 * ## Why not constants
 *
 * These were hard-coded: a personal WhatsApp number in two components, a
 * personal email on the payment screen, the operator's Google Analytics ID in
 * the root layout. In an open repository that is a phone number published to
 * every scraper on GitHub, and every fork quietly reporting its page views to
 * someone else's analytics account. Configuration that identifies a person
 * belongs to the deployment, not to the code.
 *
 * ## Unset means absent, not broken
 *
 * Every value is optional. A fork with none of them set gets a site with no
 * bug-report button, no footer credit and no analytics — which is correct for
 * a deployment whose operator has not said how to reach them. Each consumer
 * checks for null and renders nothing rather than a dead link.
 *
 * `||` rather than `??`, for the reason given in lib/site.ts: a variable left
 * blank in the Vercel dashboard is an empty string, and an empty string is
 * "not configured", not a value.
 *
 * `NEXT_PUBLIC_` because all of these end up in the HTML anyway. Next inlines
 * them at build time, so changing one needs a redeploy.
 */

function read(value: string | undefined): string | null {
  return value?.trim() || null;
}

/** Digits only, international format without the plus: 9725xxxxxxxx. */
const whatsapp = read(process.env.NEXT_PUBLIC_CONTACT_WHATSAPP)?.replace(/\D/g, "") || null;

export const CONTACT = {
  /** wa.me link for the floating bug-report button and the footer. */
  whatsappUrl: whatsapp ? `https://wa.me/${whatsapp}` : null,
  /** Where a recruiter writes when a payment does not confirm. */
  email: read(process.env.NEXT_PUBLIC_CONTACT_EMAIL),
  /** Credited in the footer and named as accessibility coordinator. */
  ownerName: read(process.env.NEXT_PUBLIC_OWNER_NAME),
  /** Where the footer credit links to: a LinkedIn profile, a homepage. */
  ownerUrl: read(process.env.NEXT_PUBLIC_OWNER_URL),
  /** Google Analytics measurement ID, G-XXXXXXXXXX. */
  gaId: read(process.env.NEXT_PUBLIC_GA_ID),
} as const;
