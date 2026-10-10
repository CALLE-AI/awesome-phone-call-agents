'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { proxied, ApiError } from '@/lib/api';
import type { BusinessDto } from '@dial/schemas';
import { BusinessProvider } from '@/components/business/business-context';
import { BusinessHeader } from '@/components/business/business-header';

/**
 * Everything under one business shares this frame: the name, and the tabs.
 *
 * Putting them here rather than inside each page means the header is fetched
 * once and does not unmount when you switch tab -- so the title stays put and
 * the tabs do not flash. Each page now renders only its own content.
 */
export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  const { businessId } = useParams<{ businessId: string }>();
  const [business, setBusiness] = useState<BusinessDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    proxied
      .getBusiness(businessId)
      .then((next) => {
        setBusiness(next);
        setError(null);
      })
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Could not load that business.'),
      );
  }, [businessId]);

  useEffect(refresh, [refresh]);

  if (error) {
    return (
      <div className="notice" data-tone="danger" role="alert">
        {error}
      </div>
    );
  }

  // The tab bar is drawn immediately with a placeholder name, so navigation is
  // usable while the details load instead of the page being briefly empty.
  if (!business) {
    return (
      <div className="business-section">
        <BusinessHeader business={null} />
        <div className="skeleton skeleton-line" style={{ width: '40%', marginTop: 24 }} />
        <div className="skeleton skeleton-line" style={{ width: '65%' }} />
      </div>
    );
  }

  return (
    <BusinessProvider value={{ business, refresh }}>
      <div className="business-section">
        <BusinessHeader business={business} />
        {children}
      </div>
    </BusinessProvider>
  );
}
