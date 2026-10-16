'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { proxied, ApiError } from '@/lib/api';
import type { BusinessListEntry } from '@dial/schemas';

/**
 * The Business landing page. When the user has none, this is onboarding, not
 * an empty table: what CALL-E can do for a business, and one button in.
 */

const TEMPLATE_CARDS = [
  {
    id: 'appointment_reminder',
    title: 'Appointment reminders',
    body: 'Confirm appointments automatically.',
  },
  {
    id: 'lead_callback',
    title: 'Customer callbacks',
    body: 'Find a good time to speak with leads and customers.',
  },
  {
    id: 'general_followup',
    title: 'Custom workflow',
    body: 'Describe another phone job.',
  },
];

export function BusinessLanding() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<BusinessListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    proxied
      .listBusinesses()
      .then((r) => setBusinesses(r.businesses))
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Could not load your businesses.'),
      );
  }, []);

  useEffect(load, [load]);

  if (error) {
    return (
      <div className="notice" data-tone="danger" role="alert">
        {error}
      </div>
    );
  }

  if (businesses && businesses.length === 0) {
    return (
      <div className="business-empty">
        <header className="page-header">
          <h1 className="page-title">Put CALL-E to work for your business</h1>
          <p className="page-subtitle">
            Automate repetitive phone work while keeping every result organized in Dial.
          </p>
        </header>

        <div className="business-template-grid">
          {TEMPLATE_CARDS.map((card) => (
            <div key={card.id} className="card business-template-card">
              <div className="card-label">{card.title}</div>
              <p className="business-card-meta">{card.body}</p>
            </div>
          ))}
        </div>

        <div className="button-row">
          <button className="button" data-variant="primary" onClick={() => router.push('/business/new')}>
            Create business
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="business-toolbar">
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>
            Your businesses
          </h1>
          <p className="business-toolbar-sub">Each one has its own workflows, contacts and calls.</p>
        </div>
        <button className="button" data-variant="primary" onClick={() => router.push('/business/new')}>
          Create business
        </button>
      </div>

      {businesses === null ? (
        <div className="business-grid" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card business-card">
              <div className="skeleton skeleton-line" style={{ width: '60%' }} />
              <div className="skeleton skeleton-line" style={{ width: '40%' }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="business-grid">
          {businesses.map((business) => (
            <Link key={business.id} href={`/business/${business.id}`} className="card business-card">
              <div className="business-card-name">{business.name}</div>
              <div className="business-card-meta">
                {business.industryLabel}
                {business.status !== 'active' ? ' · Paused' : ''}
              </div>
              <div className="business-card-stats">
                {business.activeWorkflows} active workflow{business.activeWorkflows === 1 ? '' : 's'}
                {' · '}
                {business.callsToday} call{business.callsToday === 1 ? '' : 's'} today
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
