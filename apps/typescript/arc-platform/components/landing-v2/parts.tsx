import Link from "next/link"

import { ArcLogo } from "@/components/ui/arc-logo"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Homepage primitives, built on the app's own.
 *
 * These used to be hand-rolled purple pills with their own hover states. They
 * are the app's Button now - near-black fill, 12px radius, BRANDING.md section
 * 2 - so the button a visitor presses on the homepage is the same button they
 * press on the dashboard five seconds later.
 */

export function Wrap({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1120px] px-6", className)}>{children}</div>
}

export function BtnPrimary({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Button size="lg" asChild className={cn("btn-v2", className)}>
      <Link href={href}>{children}</Link>
    </Button>
  )
}

export function BtnGhost({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Button variant="ghost" size="lg" asChild className={cn("btn-v2", className)}>
      <Link href={href}>{children}</Link>
    </Button>
  )
}

/**
 * The emphasised half of a heading.
 *
 * Was an italic serif in purple. The app has no serif and no purple, and its
 * one emphasis device - <Mark> - is documented "use at most once per screen".
 * Eight marked headings would break that rule eight times over, so the accent
 * is simply the rest of the sentence, in the same weight. The single Mark on
 * this page is in the hero.
 */
export function Em({ children }: { children: React.ReactNode }) {
  return <span className="text-text-muted">{children}</span>
}

export function SecHead({
  title,
  accent,
  lede,
}: {
  title: string
  accent: string
  lede?: string
}) {
  return (
    <div className="mb-14 flex max-w-2xl flex-col gap-4">
      <h2 className="font-display text-h1 text-text">
        {title} <Em>{accent}</Em>
      </h2>
      {lede ? <p className="text-body text-text-muted">{lede}</p> : null}
    </div>
  )
}

export function Logo({
  className,
  gradientId,
}: {
  className?: string
  /** Nav and footer both render this on one page; distinct ids keep the
   *  gradient defs unique rather than relying on first-one-wins. */
  gradientId?: string
}) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center rounded-control text-text outline-none",
        "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
        className
      )}
    >
      <ArcLogo className="h-7 w-auto" gradientId={gradientId} />
    </Link>
  )
}
