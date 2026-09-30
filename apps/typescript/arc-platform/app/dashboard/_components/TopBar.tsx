"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { CreditCard, Settings } from "lucide-react";

import { arcUserButtonAppearance } from "@/components/auth/appearance";
import { usePathname } from "next/navigation";

/**
 * Breadcrumb is a real trail derived from the route. It used to read
 * "<Brand> > Dashboard", which put the brand where a navigable level belongs -
 * the brand is context, not a step, so it now sits on the right beside the
 * account menu.
 *
 * Unknown segments (campaign ids, station slugs) are dropped rather than shown
 * raw. The trail stops at the last segment it can name honestly - unless the
 * page hands down a `crumb`, which is how a detail page contributes the one
 * label only it can know (a campaign's name for its cuid). Section 9 listed
 * the missing entity name as a known gap; this closes it.
 */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  campaigns: "Campaigns",
  radio: "Radio Stations",
  influencers: "Influencers",
  analytics: "Analytics",
  settings: "Settings",
  billing: "Billing",
  account: "Account",
};

function trailFor(pathname: string, crumb?: string): { href: string; label: string }[] {
  const parts = pathname.split("/").filter(Boolean);
  const trail: { href: string; label: string }[] = [];
  if (parts[0] !== "dashboard") trail.push({ href: "/dashboard", label: "Dashboard" });

  let href = "";
  for (const p of parts) {
    href += `/${p}`;
    const label = SEGMENT_LABELS[p];
    if (label) trail.push({ href, label });
  }
  if (crumb) trail.push({ href: pathname, label: crumb });
  return trail;
}

interface Props {
  /** Final crumb for a detail page, e.g. the campaign name. */
  crumb?: string;
}

export default function TopBar({ crumb }: Props) {
  const pathname = usePathname();
  const trail = trailFor(pathname, crumb);

  return (
    <div style={{
      position: "fixed", top: 0, left: 240, right: 0, height: 64, zIndex: 30,
      background: "var(--surface)", borderBottom: "1px solid var(--border)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 24px",
    }}>
      {/* Left: breadcrumb trail */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <span key={c.href} className="flex min-w-0 items-center gap-2">
              {i > 0 ? <span aria-hidden className="shrink-0 text-small text-text-muted">/</span> : null}
              {last ? (
                /* The final crumb is the only one that can be arbitrarily long
                   - it is a campaign's name, which the user chose. Untruncated
                   it grew past the bar and ran underneath New Campaign. It
                   truncates; the earlier crumbs are fixed labels and keep their
                   full width. */
                <span aria-current="page" className="truncate text-small font-medium text-text">{c.label}</span>
              ) : (
                <Link
                  href={c.href}
                  className="shrink-0 rounded-control text-small text-text-muted outline-none transition-colors hover:text-text focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
                >
                  {c.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      {/* Right: new campaign, account menu */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        {/* The notification bell stood here.

            It opened a panel of three hard-coded lines - a campaign approved,
            a station confirming a booking, a creator accepting a brief - none
            of which had happened, could happen, or came from anywhere. There
            is no notification source in this system: nothing writes an event,
            nothing marks one read, and the red dot was painted on. A control
            that reports invented activity is worse than no control, because a
            person reads it as news.

            Removed rather than emptied. An empty bell still promises that one
            day it will tell you something. */}

        {/* New campaign button */}
        <Link href="/campaigns/create" style={{ textDecoration: "none" }}>
          {/* Primary is near-black per section 2 - not lilac. */}
          <button className="flex cursor-pointer items-center gap-2 rounded-control border-none bg-primary px-4 py-2 text-small font-medium text-primary-fg transition-colors hover:bg-primary/85 motion-reduce:transition-none">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Campaign
          </button>
        </Link>

        {/* Account menu. Settings lives here rather than in the sidebar - it is
            account admin, not a place you navigate to while working - and
            Billing joined it for the same reason when it left the sidebar.

            This is now the only account control on the screen. The sidebar
            used to end with a second avatar, the same person's name and its
            own Log out; Clerk's Sign out below covers that. */}
        <UserButton appearance={arcUserButtonAppearance}>
          <UserButton.MenuItems>
            {/* manageAccount and signOut are Clerk's own items, named here so
                the order is ours and - more to the point - so Sign out is
                declared rather than inherited. It is now the only way out of
                the app, and a default is a poor thing to bet that on. */}
            <UserButton.Action label="manageAccount" />
            <UserButton.Link
              label="Settings"
              labelIcon={<Settings aria-hidden strokeWidth={1.75} width={16} height={16} />}
              href="/settings"
            />
            <UserButton.Link
              label="Billing"
              labelIcon={<CreditCard aria-hidden strokeWidth={1.75} width={16} height={16} />}
              href="/settings/billing"
            />
            <UserButton.Action label="signOut" />
          </UserButton.MenuItems>
        </UserButton>
      </div>
    </div>
  );
}
