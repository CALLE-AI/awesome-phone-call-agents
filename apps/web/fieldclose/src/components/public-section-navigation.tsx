"use client";

import { useSyncExternalStore } from "react";

type PublicSectionId =
  | "product"
  | "workflow"
  | "guardrails"
  | "outcomes";

export type PublicSectionNavigationItem = Readonly<{
  count?: string;
  href: `#${PublicSectionId}`;
  label: string;
}>;

type PublicSectionNavigationProps = Readonly<{
  ariaLabel: string;
  className?: string;
  items: readonly PublicSectionNavigationItem[];
}>;

const publicSectionIds = new Set<PublicSectionId>([
  "product",
  "workflow",
  "guardrails",
  "outcomes",
]);

function readActiveSection(): PublicSectionId {
  const section = window.location.hash.slice(1);

  return publicSectionIds.has(section as PublicSectionId)
    ? (section as PublicSectionId)
    : "product";
}

function readServerSection(): PublicSectionId {
  return "product";
}

function subscribeToHashChange(onStoreChange: () => void) {
  window.addEventListener("hashchange", onStoreChange);

  return () => window.removeEventListener("hashchange", onStoreChange);
}

export function PublicSectionNavigation({
  ariaLabel,
  className,
  items,
}: PublicSectionNavigationProps) {
  const activeSection = useSyncExternalStore(
    subscribeToHashChange,
    readActiveSection,
    readServerSection,
  );

  return (
    <nav aria-label={ariaLabel} className={className}>
      {items.map((item) => {
        const section = item.href.slice(1);

        return (
          <a
            aria-current={activeSection === section ? "page" : undefined}
            href={item.href}
            key={item.href}
          >
            <span>{item.label}</span>
            {item.count ? <strong>{item.count}</strong> : null}
          </a>
        );
      })}
    </nav>
  );
}
