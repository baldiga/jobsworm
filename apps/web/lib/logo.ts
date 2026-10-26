/**
 * Where a company logo is served from.
 *
 * The `company-logos` bucket is public, so this is a plain URL rather than a
 * signed one — a job card is rendered for anonymous visitors and signing a URL
 * per card per render would be absurd. See 0051 for why that tradeoff is safe:
 * nothing reaches the bucket that is not a small PNG or JPEG, checked by its
 * actual bytes rather than by the name it arrived under.
 *
 * Returns null rather than a broken string when there is no logo or no
 * configured Supabase URL, so callers render nothing instead of an alt-text
 * box with a torn-image icon.
 */
export function publicLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/company-logos/${path}`;
}
