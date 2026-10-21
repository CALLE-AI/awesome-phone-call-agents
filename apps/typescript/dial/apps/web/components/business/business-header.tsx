'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { BusinessDto } from '@dial/schemas';
import { BriefcaseIcon } from '../icons';

/**
 * The in-business frame: which business you are in, and the sections of it.
 *
 * The active tab is read from the URL rather than passed in. It used to be an
 * `active` prop that each of five callers set by hand, alongside a `business`
 * they were also each responsible for fetching -- three of them passed only an
 * id, so the heading rendered empty. One source for both removes the class of
 * bug entirely.
 */

const TABS = [
  { id: 'overview', label: 'Overview', segment: '' },
  { id: 'workflows', label: 'Workflows', segment: 'workflows' },
  { id: 'contacts', label: 'Contacts', segment: 'contacts' },
  { id: 'runs', label: 'Calls', segment: 'runs' },
  { id: 'settings', label: 'Settings', segment: 'settings' },
];

export function BusinessHeader({ business }: { business: BusinessDto | null }) {
  const pathname = usePathname();
  const base = business ? `/business/${business.id}` : '';

  // The segment straight after the id decides the tab, so nested routes such
  // as /workflows/new keep Workflows lit rather than nothing at all.
  const rest = base && pathname.startsWith(base) ? pathname.slice(base.length) : '';
  const current = rest.split('/').filter(Boolean)[0] ?? '';

  const meta = business
    ? [
        business.industryLabel,
        business.timezone,
        business.status !== 'active' ? 'Paused' : null,
      ].filter(Boolean)
    : [];

  return (
    <header className="business-header">
      <div className="business-identity">
        <span className="business-avatar" aria-hidden>
          <BriefcaseIcon size={20} />
        </span>
        <div className="business-identity-text">
          {business ? (
            <h1 className="business-name">{business.name}</h1>
          ) : (
            <span className="skeleton" style={{ width: 180, height: 24, display: 'block' }} />
          )}
          {meta.length > 0 ? (
            <p className="business-meta">
              {meta.join(' · ')}
              {business?.status !== 'active' && business ? null : null}
            </p>
          ) : null}
        </div>
        <Link className="button business-back" href="/business">
          All businesses
        </Link>
      </div>

      <nav className="business-tabs" aria-label="Business sections">
        {TABS.map((tab) => {
          const active = current === tab.segment;
          return (
            <Link
              key={tab.id}
              href={tab.segment ? `${base}/${tab.segment}` : base || '/business'}
              className="business-tab"
              aria-current={active ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
