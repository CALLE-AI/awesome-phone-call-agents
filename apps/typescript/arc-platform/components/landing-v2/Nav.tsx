import Link from "next/link"

import { NAV_LINKS } from "./content"
import { BtnPrimary, Logo, Wrap } from "./parts"

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg">
      <Wrap className="flex h-[68px] items-center justify-between">
        <Logo gradientId="arc-logo-nav" />

        <ul className="hidden list-none gap-7 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="link-v2 text-small font-medium text-text-muted no-underline hover:text-text"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2.5">
          <Link
            href="/sign-in"
            className="link-v2 rounded-control px-1.5 py-2 text-small font-medium text-text-muted no-underline outline-none hover:text-text focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Sign in
          </Link>
          <BtnPrimary href="/sign-up">
            Start a campaign
          </BtnPrimary>
        </div>
      </Wrap>
    </header>
  )
}
