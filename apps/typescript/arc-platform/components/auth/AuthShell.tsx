import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { ArcLogo } from "@/components/ui/arc-logo"
import { TunerStrip } from "@/components/ui/tuner-strip"
import { HERO_STATIONS } from "@/components/landing/stations"

/**
 * Shared chrome for sign-in and sign-up.
 *
 * The card is ours, not Clerk's: --paper, radius-card and the one shadow, with
 * the Clerk card stripped to transparent in appearance.ts. That is what lets
 * the tuner strip sit flush against the card's top edge.
 *
 * The strip runs in "band" variant - no ticks, no frequency labels. Section 5
 * says the strip is the signature, but this is a login, so it carries the mark
 * at low visual weight rather than reading as a hero.
 */
export function AuthShell({
  footerPrompt,
  footerLinkLabel,
  footerHref,
  children,
}: {
  footerPrompt: string
  footerLinkLabel: string
  footerHref: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-bg px-6 py-16 font-sans">
      <div className="flex flex-col items-center gap-2 text-center">
        <ArcLogo className="h-10 w-auto text-text" gradientId="arc-logo-auth" />
        <span className="text-small text-text-muted">
          Pakistan&apos;s first AI campaign platform
        </span>
      </div>

      <div className="w-full max-w-[460px] overflow-hidden rounded-card bg-surface shadow-card">
        <TunerStrip
          variant="band"
          label="Arc"
          segments={HERO_STATIONS}
          className="opacity-70"
        />
        <div className="p-8">{children}</div>
      </div>

      {/* Bot protection is ON for this instance (sign_up.captcha_enabled,
          widget type "smart"). Clerk mounts the widget into #clerk-captcha
          when the element exists, and falls back to rendering it inside its
          own card otherwise - where the card's overflow-hidden, needed so the
          tuner strip clips to the radius, can hide a visible challenge. A
          challenge the user cannot see is a sign-up that fails with
          captcha_missing_token and looks like nothing happened, so the widget
          gets a home of its own outside the clipped box. */}
      <div id="clerk-captcha" className="empty:hidden" />

      <p className="text-small text-text-muted">
        {footerPrompt}{" "}
        <Link
          href={footerHref}
          className="inline-flex items-center gap-1 rounded-control font-medium text-text underline underline-offset-4 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          {footerLinkLabel}
          <ArrowRight aria-hidden strokeWidth={1.75} className="size-3.5 no-underline" />
        </Link>
      </p>
    </div>
  )
}
