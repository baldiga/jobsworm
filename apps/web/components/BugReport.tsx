/**
 * "Found a bug? Let me know" — a standing link to the operator on WhatsApp.
 *
 * A server component: it is a link, so there is nothing to hydrate.
 *
 * Renders nothing unless NEXT_PUBLIC_CONTACT_WHATSAPP is set (lib/contact.ts):
 * a bug button that opens nowhere is worse than none.
 *
 * Positioned bottom-end rather than bottom-right so it moves to the left edge
 * if the site is ever run in RTL, and it sits above the page but below the
 * sticky header's z-30. `pb-[env(safe-area-inset-bottom)]` keeps it clear of
 * the home indicator on an iPhone, where a fixed element at the very bottom is
 * otherwise half-unreachable.
 *
 * The label is ALWAYS visible, including on a phone. It was icon-only below
 * 640px to keep a floating pill from covering a job card's apply button — but
 * a lone speech bubble in the corner reads as a chat widget, and nobody taps a
 * button whose purpose they have to guess. Kept narrow instead: smaller text
 * and tighter padding on small screens, so it stays out of the way while still
 * saying what it is.
 */
import { MessageCircle } from "lucide-react";
import { CONTACT } from "@/lib/contact";

export default function BugReport() {
  if (!CONTACT.whatsappUrl) return null;
  const firstName = CONTACT.ownerName?.split(/\s+/)[0];
  const greeting = `Hi${firstName ? ` ${firstName}` : ""}, I found a bug on Jobsworm: `;
  return (
    <a
      href={`${CONTACT.whatsappUrl}?text=${encodeURIComponent(greeting)}`}
      target="_blank"
      rel="noopener noreferrer"
      /* Says WhatsApp, which the visible label does not, so nobody is
         surprised by which app opens. */
      aria-label="Found a bug? Let me know on WhatsApp"
      className="fixed bottom-4 end-4 z-20 inline-flex min-h-11 items-center gap-1.5 rounded-chip border border-line bg-surface px-3 py-2 text-[13px] font-medium text-fg shadow-[0_2px_10px_rgba(31,27,22,0.10)] transition-all hover:border-line-strong hover:bg-surface-2 active:scale-95 sm:min-h-12 sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <MessageCircle aria-hidden="true" className="size-4 shrink-0 text-action-text sm:size-[18px]" />
      <span>Found a bug? Let me know</span>
    </a>
  );
}
