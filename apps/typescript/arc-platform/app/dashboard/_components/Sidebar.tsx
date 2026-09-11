"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { usePathname } from "next/navigation";

import { ArcLogo } from "@/components/ui/arc-logo";

const NAV = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    href: "/campaigns",
    label: "Campaigns",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
    ),
  },
  {
    href: "/radio",
    label: "Radio Stations",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0"/><circle cx="12" cy="12" r="1"/>
        <path d="M6.3 6.3a8 8 0 0 0 0 11.4"/><path d="M17.7 6.3a8 8 0 0 1 0 11.4"/>
        <path d="M9.5 9.5a4 4 0 0 0 0 5"/><path d="M14.5 9.5a4 4 0 0 1 0 5"/>
      </svg>
    ),
  },
  {
    href: "/influencers",
    label: "Influencers",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
      </svg>
    ),
  },
];

const PLAN_LABELS: Record<string, string> = {
  STARTER: "STARTER PLAN", GROWTH: "GROWTH PLAN",
  ENTERPRISE: "ENTERPRISE PLAN", FREE_TRIAL: "FREE TRIAL",
};

/** Ambient counts, resolved by the layout. Muted, mono, right-aligned; a zero
 *  renders nothing rather than "0", so an empty catalogue stays quiet. */
interface Props {
  brandName: string;
  plan: string;
  counts?: Record<string, number>;
}

/* The sidebar used to end with the signed-in person's avatar, their name and a
   Log out button - a second account control, when the top bar already carries
   Clerk's UserButton with the same avatar, the same identity and its own Sign
   out. Two of them meant two answers to "who am I signed in as". The sidebar's
   copy is gone; the top-right one stays, and sign-out goes with it.

   Billing left this list at the same time. It is account admin rather than
   somewhere you navigate to mid-campaign, so it lives under Settings now. The
   Upgrade link below still reaches it in one click, which is the moment
   somebody actually wants it. */
export default function Sidebar({ brandName, plan, counts }: Props) {
  const pathname = usePathname();

  return (
    <div style={{
      position: "fixed", left: 0, top: 0, bottom: 0, width: 240,
      background: "var(--surface)", borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column", zIndex: 40,
    }}>
      {/* Logo + Brand */}
      <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)" }}>
        {/* The supplied mark, the same one the homepage and sign-in carry.
            This was `ARC` typed at letter-spacing 5 with a lilac dot beside
            it - an approximation of a logo that already exists, and the last
            place in the app still drawing one.

            The dot goes with it. It stood in for the brand's accent; the mark
            ends in the gradient arc that IS the accent, so keeping both put
            two of them next to each other. */}
        <Link href="/dashboard" style={{ display: "block", marginBottom: 12 }} aria-label="Arc — dashboard">
          <ArcLogo className="h-6 w-auto text-text" gradientId="arc-logo-sidebar" />
        </Link>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--bg)", borderRadius: 8, padding: "8px 10px",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: "var(--lilac-deep)", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 11, fontWeight: 700, color: "var(--text)",
            flexShrink: 0,
          }}>
            {brandName.slice(0, 2).toUpperCase()}
          </div>
          <span style={{
            color: "var(--text)", fontSize: 13, fontWeight: 500,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {brandName}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
        {NAV.map(item => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
              {/* Hierarchy, not decoration: the active item is the only colour
                  in the list. One stroke weight and size throughout - giving
                  each item its own hue would break the density rule. */}
              <div
                className={
                  "mb-0.5 flex cursor-pointer items-center gap-2.5 rounded-control px-3 py-2.5 text-small transition-colors motion-reduce:transition-none " +
                  (active
                    ? "bg-lilac font-medium text-ink [&_svg]:text-ink"
                    : "text-text-muted hover:bg-lilac/40 [&_svg]:text-text-muted")
                }
              >
                {item.icon}
                <span style={{ flex: 1 }}>{item.label}</span>
                {counts?.[item.href] ? (
                  <span className="type-data" style={{ color: "var(--text-muted)", fontSize: 11 }}>
                    {counts[item.href]}
                  </span>
                ) : null}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
        {/* Plan badge */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 12,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
            color: "var(--text-muted)", background: "rgba(79,70,229,0.2)",
            padding: "3px 8px", borderRadius: 20,
          }}>
            {PLAN_LABELS[plan] ?? plan}
          </span>
          {plan === "STARTER" && (
            <Link href="/settings/billing" style={{
              fontSize: 11, color: "var(--lilac-deep)", fontWeight: 500, textDecoration: "none",
            }}>Upgrade <ArrowRight aria-hidden strokeWidth={1.75} style={{ width: 14, height: 14 }} /></Link>
          )}
        </div>
      </div>
    </div>
  );
}
