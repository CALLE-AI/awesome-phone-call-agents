"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CreditCard, UserRound } from "lucide-react";

/**
 * Settings is a place with rooms in it, not a single form.
 *
 * Billing used to be a top-level sidebar item, sat between Analytics and
 * nothing, as though a plan were somewhere you go mid-campaign. It is account
 * admin, so it moved in here beside the brand's own details and the Clerk
 * account. The sidebar's Upgrade link still lands straight on Billing, which
 * is the one moment somebody genuinely wants it in one click.
 *
 * Route-based rather than tabs: each section is a real URL, so it can be
 * linked to, bookmarked and reached by the back button. Clerk's UserProfile
 * needs its own path segment anyway.
 */
const SECTIONS = [
  { href: "/settings", label: "Brand", icon: Building2, hint: "Name your campaigns are booked under" },
  { href: "/settings/billing", label: "Billing", icon: CreditCard, hint: "Plan, credits and invoices" },
  { href: "/settings/account", label: "Account", icon: UserRound, hint: "Email, password and sessions" },
];

export default function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="flex flex-wrap gap-1 border-b border-border pb-3">
      {SECTIONS.map(({ href, label, icon: Icon, hint }) => {
        /* Exact match for /settings so that Billing and Account do not also
           light it up; prefix match for the rest so Clerk's nested profile
           routes keep Account active. */
        const active = href === "/settings" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            title={hint}
            className={
              "flex items-center gap-2 rounded-control px-3 py-2 text-small outline-none transition-colors focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none " +
              (active
                ? "bg-lilac font-medium text-ink"
                : "text-text-muted hover:bg-lilac/40 hover:text-text")
            }
          >
            <Icon aria-hidden strokeWidth={1.75} className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
