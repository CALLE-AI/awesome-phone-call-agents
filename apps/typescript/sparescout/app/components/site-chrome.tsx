import type { ReactNode } from "react";
import Link from "next/link";

const primaryLinks = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/markets", label: "Markets" },
  { href: "/safety", label: "Safety" },
  { href: "/history", label: "History" },
  { href: "/about", label: "About" },
];

const mobileLinks = [
  ...primaryLinks,
  { href: "/pilot", label: "Pilot evidence" },
  { href: "/privacy", label: "Privacy" },
];

export function SiteHeader({ badge }: { badge?: string }) {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="SpareScout home">
        <span className="brand-mark" aria-hidden="true">S</span>
        <span>SpareScout</span>
      </Link>
      <nav className="site-nav" aria-label="Primary navigation">
        {primaryLinks.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}
      </nav>
      <details className="mobile-nav">
        <summary aria-label="Open site navigation">Menu</summary>
        <nav aria-label="Mobile navigation">
          {mobileLinks.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}
        </nav>
      </details>
      {badge && <span className="location-pill"><span className="status-dot" />{badge}</span>}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>Phone-powered parts sourcing with evidence, boundaries, and a human decision at every consequential step.</p>
      <nav aria-label="Footer navigation">
        <Link href="/pilot">Pilot evidence</Link>
        <Link href="/history">Request history</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/safety">Safety</Link>
        <Link href="/">Try the demo</Link>
      </nav>
      <span>Powered by CALL-E · Approval gated</span>
    </footer>
  );
}

export function PublicPage({ eyebrow, title, intro, children }: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main>
      <SiteHeader badge="Global pilot" />
      <section className="public-hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{intro}</p>
      </section>
      <div className="public-content">{children}</div>
      <SiteFooter />
    </main>
  );
}
