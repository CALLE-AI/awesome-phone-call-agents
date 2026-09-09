"use client";

import type { ReactNode } from "react";
import { useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sundials } from "@/lib/sdk";

const NAV = [
  { href: "/demo", label: "Platform" },
  { href: "/demo/pricing", label: "Pricing" },
  { href: "/demo/reviews", label: "Customers" },
  { href: "/demo/faq", label: "FAQ" },
  { href: "/demo/contact", label: "Contact" }
];

function HarborMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-harbor-navy text-white">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
          <path
            d="M4 14c2.4-1.2 4.4-1.8 8-1.8s5.6.6 8 1.8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M5.5 17.5c2.2-.9 4.1-1.3 6.5-1.3s4.3.4 6.5 1.3"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.7"
          />
          <path d="M12 5v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="5" r="1.4" fill="currentColor" />
        </svg>
      </span>
      <span className="font-heading text-xl text-foreground">Harbor</span>
    </span>
  );
}

export function HarborShell({
  children,
  apiKey,
  accountId = "harbor"
}: {
  children: ReactNode;
  apiKey?: string;
  accountId?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const onLearnMore = useCallback(() => {
    router.push("/demo/pricing");
  }, [router]);

  return (
    <div className="harbor min-h-screen w-full max-w-none bg-background text-foreground">
      <Sundials
        accountId={accountId}
        apiKey={apiKey || ""}
        brandName="Harbor"
        title="Want a walkthrough of Harbor?"
        description="Tell us about your revenue team. We will show you the workspace, not a slide deck."
        primaryAction="talk_to_sales"
        learnMoreHref="/demo/pricing"
        onLearnMore={onLearnMore}
      />
      <header className="sticky top-0 z-40 w-full border-b border-border/80 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <Link href="/demo" className="tracking-tight">
            <HarborMark />
          </Link>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Button key={item.href} variant={active ? "secondary" : "ghost"} size="sm" asChild>
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              );
            })}
          </nav>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/demo/pricing" data-sc-cta="learn_more">
                Learn more
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/demo/contact" data-sc-cta="get_demo">
                Get Demo
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="w-full max-w-none pb-36">{children}</main>
      <footer className="harbor-full-bleed bg-harbor-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-4">
          <div className="space-y-3 md:col-span-1">
            <p className="font-heading text-2xl">Harbor</p>
            <p className="text-sm leading-relaxed text-white/65">
              The CRM for high-ticket revenue teams. Pipeline, marketing, and service in one operating system.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-white/70 uppercase">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-white/80">
              <li>
                <Link href="/demo">Platform</Link>
              </li>
              <li>
                <Link href="/demo/pricing">Pricing</Link>
              </li>
              <li>
                <Link href="/demo/reviews">Customers</Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-white/70 uppercase">Company</p>
            <ul className="mt-3 space-y-2 text-sm text-white/80">
              <li>
                <Link href="/demo/faq">FAQ</Link>
              </li>
              <li>
                <Link href="/demo/contact">Talk to sales</Link>
              </li>
              <li>
                <Link href="/app/home">Sundials dashboard</Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-white/70 uppercase">Trust</p>
            <ul className="mt-3 space-y-2 text-sm text-white/80">
              <li>SOC 2 Type II</li>
              <li>GDPR ready</li>
              <li>SSO / SCIM on Enterprise</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-5 text-xs text-white/70 sm:flex-row sm:justify-between">
            <span>© 2026 Harbor CRM. Fictional product used to demonstrate Sundials.</span>
            <span>Call while your lead is warm.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
