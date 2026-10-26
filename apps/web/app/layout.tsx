import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Roboto, Assistant } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import { WormCrossing } from "@/components/ui/Worm";
import "./globals.css";
import BugReport from "@/components/BugReport";
import AccountChip from "@/components/AccountChip";
import MobileNav from "@/components/MobileNav";
import AnnounceBar from "@/components/AnnounceBar";
import { SITE_URL } from "@/lib/site";
import { CONTACT } from "@/lib/contact";

/**
 * Google Analytics.
 *
 * `afterInteractive` rather than `beforeInteractive`: analytics is never worth
 * delaying the first paint of a search result for. Next hoists both tags and
 * loads them once the page is usable.
 *
 * This does set `_ga` cookies and sends page views to Google, so the privacy
 * notice says so. A site that tells people it stores almost nothing about them
 * cannot quietly add third-party tracking and leave the page unchanged.
 *
 * Only loaded when NEXT_PUBLIC_GA_ID is set. The ID used to be a constant
 * here, which in an open repository means every fork sends its traffic to
 * the original operator's analytics account.
 */
const GA_ID = CONTACT.gaId;

/*
 * Three families, and the split between them is deliberate.
 *
 *   Space Grotesk — headings. A geometric grotesque with enough character in
 *                   its letterforms to not read as a default sans.
 *   Roboto        — the English UI. Neither covers Hebrew, which is fine
 *                   because the interface is English-only.
 *   Assistant     — job CONTENT only, via `.jobtext`. Employer text is often
 *                   Hebrew and often mixed ("מפתח Full Stack"); Assistant
 *                   covers both scripts, so one string is set in one typeface
 *                   instead of falling through mid-sentence into a second.
 *
 * next/font self-hosts all three at build time, so there is no runtime request
 * to Google and no layout shift from a third-party stylesheet.
 */
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

const roboto = Roboto({
  subsets: ["latin"],
  variable: "--font-roboto",
  display: "swap",
});

const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  variable: "--font-assistant",
  display: "swap",
  fallback: ["Noto Sans Hebrew", "Arial Hebrew", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Jobsworm — Every Israeli tech job, in one place",
    template: "%s · Jobsworm",
  },
  description:
    "Every place recruiters post jobs, gathered into one searchable index. Free for job seekers, forever. Organic results are never sold; sponsored listings are always labelled.",
  applicationName: "Jobsworm",
  /*
   * No `images` key here on purpose: app/opengraph-image.tsx supplies the card
   * through Next's file convention. Listing a path here would override it, and
   * the path that used to be listed (/brand/og-default.png) did not exist, so
   * every shared link previewed with a blank image.
   */
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Jobsworm",
    title: "Jobsworm — Every Israeli tech job, in one place",
    description:
      "Every place recruiters post jobs, in one search. Free for job seekers, forever.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Jobsworm — Every Israeli tech job, in one place",
    description: "Every place recruiters post jobs, in one search. Free for job seekers, forever.",
  },
  icons: {
    icon: "/brand/favicon.ico",
    apple: "/brand/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#FBFAF7",
};

/*
 * "My area" is not in this list any more. It is the account chip at the end of
 * the header — a person icon, with your name beside it once you are signed in
 * — so having it here as well would put the same destination in the bar twice.
 */
const NAV = [
  { href: "/jobs", label: "Jobs" },
  { href: "/match", label: "Find by CV" },
  { href: "/recruit", label: "Recruiters" },
];

const FOOTER_NAV = [
  { href: "/jobs", label: "Jobs" },
  { href: "/match", label: "Find by CV" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/accessibility", label: "Accessibility" },
];

/*
 * A link you can actually hit with a thumb.
 *
 * The footer links were bare inline anchors: 14px text, no padding, so roughly
 * 22 pixels tall. That is half the 44px minimum, and it is why they were
 * reported as "not clickable" on a phone — the markup and the hrefs were always
 * fine, the target was just too small to hit. The header links had padding and
 * worked, which is the tell.
 *
 * The padding is cancelled by a negative margin on the nav, so the footer looks
 * the same and only the hit area grows.
 */
const FOOTER_LINK =
  "inline-flex min-h-11 items-center rounded-control px-2 py-2 text-fg-2 transition-all duration-100 " +
  "hover:bg-surface-2 hover:text-fg hover:underline active:scale-95 active:bg-surface-2 active:text-fg";

function Header() {
  return (
    /*
     * `relative` so the mobile panel can hang off the bottom of the header
     * rather than off the page — `absolute inset-x-0 top-full` needs a
     * positioned ancestor, and without one the menu opens at the top of the
     * document behind the sticky bar.
     */
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md relative">
      <div className="mx-auto flex w-full max-w-[1120px] items-center gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5"
          aria-label="Jobsworm home"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mascot-128.png" alt="" width={30} height={30} className="h-[30px] w-auto" />
          <span className="font-[family-name:var(--font-display)] text-[22px] font-bold leading-none tracking-[-0.03em] text-fg">
            Jobsworm
          </span>
        </Link>

        <div className="ms-auto flex items-center gap-0.5 text-[15px] sm:gap-1">
          {/*
            Two renderings of one list, chosen by CSS rather than by measuring
            the window after hydration — a width read in JavaScript always
            paints the wrong one first.
          */}
          <nav aria-label="Main" className="hidden items-center gap-0.5 sm:flex sm:gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex min-h-11 items-center rounded-control px-2.5 py-2 font-medium text-fg-2 transition-all duration-100 hover:bg-surface-2 hover:text-fg active:scale-95 active:bg-surface-2 active:text-fg sm:px-3"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Always visible, both widths: signing in is worth seeing at a glance. */}
          <AccountChip />
          <MobileNav items={NAV} />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-20 border-t border-line">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <p className="m-0 font-[family-name:var(--font-display)] text-lg font-bold tracking-[-0.02em]">
              Jobsworm
            </p>
            <p className="m-0 mt-1.5 text-sm text-fg-2">
              Every place recruiters post jobs, in one search. Free for job seekers, forever.
              Employers and agencies can buy a labelled sponsored slot; that never changes
              search order.
            </p>
          </div>

          <nav
            aria-label="Footer"
            className="-mx-2 -my-2 flex flex-wrap items-center gap-x-2 text-sm"
          >
            {FOOTER_NAV.map((item) => (
              <Link key={item.href} href={item.href} className={FOOTER_LINK}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-8 border-t border-line pt-5 text-[13px] text-fg-2">
          {/*
            Operator credit and contact come from the environment (lib/contact.ts),
            so a fork neither credits nor publishes someone else's phone number.
          */}
          <p className="m-0">
            {CONTACT.ownerName ? (
              <>
                Built and run by{" "}
                {CONTACT.ownerUrl ? (
                  <a
                    href={CONTACT.ownerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block py-1 font-medium text-action-text underline underline-offset-2 hover:text-action-hover"
                  >
                    {CONTACT.ownerName}
                  </a>
                ) : (
                  CONTACT.ownerName
                )}
                .{" "}
              </>
            ) : null}
            Job seekers are never charged; employers and agencies can pay for clearly labelled
            placement, which never affects where jobs rank.
          </p>

          {/* The blank line the copy asks for, as spacing rather than an empty <p>. */}
          {CONTACT.whatsappUrl ? (
            <p className="m-0 mt-6">
              Want to support this project? Reach out on WhatsApp{" "}
              <a
                href={CONTACT.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block py-1 font-medium text-action-text underline underline-offset-2 hover:text-action-hover"
              >
                here
              </a>
              .
            </p>
          ) : null}

          <p className="m-0 mt-6">
            Built in Israel. Job listings belong to their original publishers and link back to
            them.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${grotesk.variable} ${roboto.variable} ${assistant.variable}`}
    >
      <body className="flex min-h-dvh flex-col bg-bg text-fg">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-action focus:px-4 focus:py-2 focus:text-on-action"
        >
          Skip to content
        </a>
        <Header />
        {/*
          Below the header, not inside it: the header is `sticky top-0`, and an
          announcement that follows the reader down every page is an
          advertisement, not a notice. This scrolls away with the hero.
        */}
        <AnnounceBar />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
        {/* Decorative, aria-hidden, and rare. See components/ui/Worm.tsx. */}
        <WormCrossing />
        <BugReport />

        {GA_ID ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
            </Script>
          </>
        ) : null}
      </body>
    </html>
  );
}
