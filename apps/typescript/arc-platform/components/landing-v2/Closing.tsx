import Link from "next/link"

import { CLOSING, FOOTER } from "./content"
import { BtnGhost, BtnPrimary, Em, Logo, Wrap } from "./parts"

export function Closing() {
  return (
    <section className="py-20 text-center md:py-[120px]">
      <Wrap>
        <h2 className="mx-auto mb-5 max-w-[16em] font-display text-h1 text-text">
          {CLOSING.title} <Em>{CLOSING.titleAccent}</Em>
        </h2>
        <p className="mb-9 text-body text-text-muted">{CLOSING.lede}</p>
        <div className="flex flex-wrap justify-center gap-3.5">
          <BtnPrimary href="/sign-up">{CLOSING.primary}</BtnPrimary>
          <BtnGhost href="/sign-in">{CLOSING.secondary}</BtnGhost>
        </div>
      </Wrap>
    </section>
  )
}

export function Foot() {
  return (
    <footer className="border-t border-border py-11 text-small text-text-muted">
      <Wrap className="flex flex-wrap items-center justify-between gap-5">
        <span className="flex items-center gap-2">
          <Logo gradientId="arc-logo-footer" />
          <span>&nbsp;{FOOTER.copyright}</span>
        </span>
        <ul className="flex list-none gap-[22px]">
          {FOOTER.links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="link-v2 rounded-control no-underline outline-none hover:text-text focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </Wrap>
    </footer>
  )
}
